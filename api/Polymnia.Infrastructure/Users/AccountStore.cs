using Microsoft.EntityFrameworkCore;
using Polymnia.Core.Users;

namespace Polymnia.Infrastructure.Users;

/// <summary>
/// Account-level operations of the signed-in user: erasure and the metadata of the data export.
/// Every query is filtered by the user id taken from the session, never from the request.
/// </summary>
public sealed class AccountStore(PolymniaDbContext db, TimeProvider time)
{
    /// <summary>
    /// Deletes the user. The database does the rest: scores, sessions (and any other table that references the user)
    /// are removed by <c>ON DELETE CASCADE</c> in the same statement, so nothing can be left behind.
    /// </summary>
    public async Task<bool> DeleteAsync(Guid userId, CancellationToken cancellationToken) =>
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync(cancellationToken) > 0;

    public async Task<AccountProfile?> GetProfileAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await db.Users
            .AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new { u.Id, u.GoogleSubject, u.DisplayName, u.AvatarUrl, u.PreferredLanguage, u.CreatedAt, u.LastSeenAt })
            .FirstOrDefaultAsync(cancellationToken);
        if (user is null)
        {
            return null;
        }

        // Only the dates: the key hash and the encrypted ticket are credentials, not personal data to hand out.
        DateTimeOffset now = time.GetUtcNow();
        List<SessionInfo> sessions = await db.Sessions
            .AsNoTracking()
            .Where(s => s.UserId == userId && s.ExpiresAt > now && s.AbsoluteExpiresAt > now)
            .OrderBy(s => s.CreatedAt)
            .Select(s => new SessionInfo(s.CreatedAt, s.ExpiresAt, s.AbsoluteExpiresAt))
            .ToListAsync(cancellationToken);

        List<ShareLinkInfo> shareLinks = await db.ShareLinks
            .AsNoTracking()
            .Where(l => db.Scores.Any(s => s.Id == l.ScoreId && s.OwnerId == userId))
            .OrderBy(l => l.CreatedAt)
            .Select(l => new ShareLinkInfo(l.ScoreId, l.CreatedAt, l.RevokedAt))
            .ToListAsync(cancellationToken);

        return new AccountProfile(
            user.Id, user.GoogleSubject, user.DisplayName, user.AvatarUrl, user.PreferredLanguage,
            user.CreatedAt, user.LastSeenAt, sessions, shareLinks);
    }

    /// <summary>The user's scores, without content. The number is bounded by <c>Scores:MaxScoresPerUser</c>.</summary>
    public async Task<IReadOnlyList<ScoreExportRow>> ListScoresAsync(Guid userId, CancellationToken cancellationToken) =>
        await db.Scores
            .AsNoTracking()
            .Where(s => s.OwnerId == userId)
            .OrderBy(s => s.CreatedAt)
            .ThenBy(s => s.Id)
            .Select(s => new ScoreExportRow(s.Id, s.Title, s.SchemaVersion, s.Version, s.CreatedAt, s.UpdatedAt))
            .ToListAsync(cancellationToken);
}
