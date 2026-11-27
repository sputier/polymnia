using Microsoft.EntityFrameworkCore;
using Npgsql;
using Polymnia.Core.Scores;
using Polymnia.Core.Sharing;

namespace Polymnia.Infrastructure.Sharing;

/// <summary>
/// Management of share links by the owner of a score. Like <see cref="Scores.ScoreStore"/>, access control lives here:
/// a score that belongs to someone else is indistinguishable from a score that does not exist. Only the hash of the
/// token is stored; the raw token is returned once, by <see cref="CreateAsync"/>.
/// </summary>
public sealed class ShareStore(PolymniaDbContext db, TimeProvider clock)
{
    public async Task<ScoreResult<ShareStatus>> GetStatusAsync(Guid owner, Guid scoreId, CancellationToken ct)
    {
        if (!await OwnsAsync(owner, scoreId, ct))
        {
            return new(ScoreOutcome.NotFound);
        }

        DateTimeOffset? createdAt = await db.ShareLinks.AsNoTracking()
            .Where(l => l.ScoreId == scoreId && l.RevokedAt == null)
            .Select(l => (DateTimeOffset?)l.CreatedAt)
            .FirstOrDefaultAsync(ct);
        return new(ScoreOutcome.Ok, new ShareStatus(createdAt is not null, createdAt));
    }

    /// <summary>
    /// Creates the link of the score, revoking the active one if any (regenerating). Revoked links from earlier
    /// regenerations are deleted, so a score never holds more than two rows.
    /// </summary>
    public async Task<ScoreResult<ShareCreated>> CreateAsync(Guid owner, Guid scoreId, CancellationToken ct)
    {
        if (!await OwnsAsync(owner, scoreId, ct))
        {
            return new(ScoreOutcome.NotFound);
        }

        string token = ShareToken.Generate();
        DateTimeOffset now = clock.GetUtcNow();
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.ShareLinks.Where(l => l.ScoreId == scoreId && l.RevokedAt != null).ExecuteDeleteAsync(ct);
            await db.ShareLinks.Where(l => l.ScoreId == scoreId && l.RevokedAt == null)
                .ExecuteUpdateAsync(set => set.SetProperty(l => l.RevokedAt, now), ct);
            db.ShareLinks.Add(new ShareLink
            {
                Id = Guid.CreateVersion7(),
                ScoreId = scoreId,
                TokenHash = ShareToken.Hash(token),
                CreatedAt = now,
            });
            try
            {
                await db.SaveChangesAsync(ct);
            }
            finally
            {
                db.ChangeTracker.Clear();
            }

            await transaction.CommitAsync(ct);
            return new(ScoreOutcome.Ok, new ShareCreated(token, now));
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Another creation for the same score won the race (one active link per score).
            return new(ScoreOutcome.Conflict);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.ForeignKeyViolation })
        {
            // The score was deleted in the meantime.
            return new(ScoreOutcome.NotFound);
        }
    }

    /// <summary>Revokes the active link, if any. Idempotent for a score the caller owns.</summary>
    public async Task<bool> RevokeAsync(Guid owner, Guid scoreId, CancellationToken ct)
    {
        if (!await OwnsAsync(owner, scoreId, ct))
        {
            return false;
        }

        DateTimeOffset now = clock.GetUtcNow();
        await db.ShareLinks.Where(l => l.ScoreId == scoreId && l.RevokedAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(l => l.RevokedAt, now), ct);
        return true;
    }

    private Task<bool> OwnsAsync(Guid owner, Guid scoreId, CancellationToken ct) =>
        db.Scores.AsNoTracking().AnyAsync(s => s.OwnerId == owner && s.Id == scoreId, ct);
}
