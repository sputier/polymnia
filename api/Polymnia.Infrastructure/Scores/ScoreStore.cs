using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;
using Polymnia.Core.Scores;

namespace Polymnia.Infrastructure.Scores;

/// <summary>
/// Score persistence. Access control lives here, not in the endpoints: every query is filtered by the owner id,
/// so a score that belongs to someone else is indistinguishable from a score that does not exist.
/// Reads use <c>AsNoTracking()</c> and the list never loads <c>content</c>.
/// </summary>
public sealed class ScoreStore(PolymniaDbContext db, TimeProvider clock, IOptions<ScoreOptions> options)
{
    private readonly int _maxScores = options.Value.MaxScoresPerUser;

    public async Task<ScorePage> ListAsync(Guid owner, string? search, int page, int pageSize, CancellationToken ct)
    {
        IQueryable<Score> query = db.Scores.AsNoTracking().Where(s => s.OwnerId == owner);
        if (!string.IsNullOrEmpty(search))
        {
            string pattern = "%" + EscapeLike(search) + "%";
            query = query.Where(s => EF.Functions.ILike(s.Title, pattern, "\\"));
        }

        int total = await query.CountAsync(ct);
        List<ScoreSummary> items = await query
            .OrderByDescending(s => s.UpdatedAt)
            .ThenByDescending(s => s.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(s => new ScoreSummary(s.Id, s.Title, s.SchemaVersion, s.Version, s.CreatedAt, s.UpdatedAt))
            .ToListAsync(ct);
        return new ScorePage(items, page, pageSize, total);
    }

    /// <summary>
    /// Reads the content. With <paramref name="knownVersion"/> (from <c>If-None-Match</c>), a cheap version-only
    /// query answers first and the (large) content is only loaded when the caller's copy is stale.
    /// </summary>
    public async Task<ScoreResult<ScoreContent>> GetContentAsync(Guid owner, Guid id, long? knownVersion, CancellationToken ct)
    {
        IQueryable<Score> mine = db.Scores.AsNoTracking().Where(s => s.OwnerId == owner && s.Id == id);

        if (knownVersion is not null)
        {
            long? current = await mine.Select(s => (long?)s.Version).FirstOrDefaultAsync(ct);
            if (current is null)
            {
                return new(ScoreOutcome.NotFound);
            }

            if (current == knownVersion)
            {
                return new(ScoreOutcome.Ok, new ScoreContent(current.Value, null, null));
            }
        }

        return await OpenContentAsync(owner, id, ct);
    }

    // The document goes from PostgreSQL to the response as bytes: no 2 MB UTF-16 string on the large object heap.
    private async Task<ScoreResult<ScoreContent>> OpenContentAsync(Guid owner, Guid id, CancellationToken ct)
    {
        await db.Database.OpenConnectionAsync(ct);
        NpgsqlCommand? command = null;
        System.Data.Common.DbDataReader? reader = null;
        try
        {
            command = new NpgsqlCommand(
                "SELECT version, convert_to(content::text, 'UTF8') FROM scores WHERE owner_id = $1 AND id = $2",
                (NpgsqlConnection)db.Database.GetDbConnection())
            {
                Parameters = { new() { Value = owner }, new() { Value = id } },
            };
            reader = await command.ExecuteReaderAsync(System.Data.CommandBehavior.SequentialAccess, ct);
            if (!await reader.ReadAsync(ct))
            {
                await ReleaseAsync(reader, command);
                return new(ScoreOutcome.NotFound);
            }

            long version = reader.GetInt64(0);
            Stream body = reader.GetStream(1);
            return new(ScoreOutcome.Ok, new ScoreContent(version, body, new Lease(this, reader, command)));
        }
        catch
        {
            await ReleaseAsync(reader, command);
            throw;
        }
    }

    private async ValueTask ReleaseAsync(System.Data.Common.DbDataReader? reader, NpgsqlCommand? command)
    {
        if (reader is not null)
        {
            await reader.DisposeAsync();
        }

        if (command is not null)
        {
            await command.DisposeAsync();
        }

        await db.Database.CloseConnectionAsync();
    }

    private sealed class Lease(ScoreStore store, System.Data.Common.DbDataReader reader, NpgsqlCommand command) : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => store.ReleaseAsync(reader, command);
    }

    public Task<ScoreResult<ScoreSummary>> CreateAsync(Guid owner, ScoreDocument document, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(document);
        Guid id = Guid.CreateVersion7();
        DateTimeOffset now = clock.GetUtcNow();
        return InsertWithinQuotaAsync(
            owner,
            new ScoreSummary(id, document.Title, document.SchemaVersion, 1, now, now),
            async () =>
            {
                db.Scores.Add(new Score
                {
                    Id = id,
                    OwnerId = owner,
                    Title = document.Title,
                    Content = document.Json,
                    SchemaVersion = document.SchemaVersion,
                    Version = 1,
                    CreatedAt = now,
                    UpdatedAt = now,
                });
                try
                {
                    await db.SaveChangesAsync(ct);
                }
                finally
                {
                    db.ChangeTracker.Clear();
                }

                return 1;
            },
            ct);
    }

    public async Task<ScoreResult<ScoreSaved>> UpdateContentAsync(
        Guid owner, Guid id, long expectedVersion, ScoreDocument document, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(document);
        DateTimeOffset now = clock.GetUtcNow();
        try
        {
            int rows = await db.Scores
                .Where(s => s.OwnerId == owner && s.Id == id && s.Version == expectedVersion)
                .ExecuteUpdateAsync(
                    set => set
                        .SetProperty(s => s.Content, document.Json)
                        .SetProperty(s => s.Title, document.Title)
                        .SetProperty(s => s.SchemaVersion, document.SchemaVersion)
                        .SetProperty(s => s.Version, s => s.Version + 1)
                        .SetProperty(s => s.UpdatedAt, now),
                    ct);
            return rows > 0
                ? new(ScoreOutcome.Ok, new ScoreSaved(id, document.Title, document.SchemaVersion, expectedVersion + 1, now))
                : await FailureAsync(owner, id, ct);
        }
        catch (PostgresException ex) when (IsInvalidData(ex))
        {
            return new(ScoreOutcome.InvalidContent);
        }
    }

    /// <summary>Renames the score and keeps <c>meta.title</c> in the content in sync (it is a content change: same version rules).</summary>
    public async Task<ScoreResult<ScoreSaved>> RenameAsync(
        Guid owner, Guid id, string title, long expectedVersion, CancellationToken ct)
    {
        DateTimeOffset now = clock.GetUtcNow();
        int rows = await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            UPDATE scores
            SET title = {title},
                content = jsonb_set(content, array['meta','title'], to_jsonb({title}::text)),
                version = version + 1,
                updated_at = {now}
            WHERE owner_id = {owner} AND id = {id} AND version = {expectedVersion}
            """,
            ct);
        if (rows == 0)
        {
            return await FailureAsync(owner, id, ct);
        }

        int schemaVersion = await db.Scores.AsNoTracking()
            .Where(s => s.OwnerId == owner && s.Id == id)
            .Select(s => s.SchemaVersion)
            .FirstOrDefaultAsync(ct);
        return new(ScoreOutcome.Ok, new ScoreSaved(id, title, schemaVersion, expectedVersion + 1, now));
    }

    public async Task<ScoreResult<ScoreSummary>> DuplicateAsync(Guid owner, Guid id, CancellationToken ct)
    {
        var source = await db.Scores.AsNoTracking()
            .Where(s => s.OwnerId == owner && s.Id == id)
            .Select(s => new { s.Title, s.SchemaVersion })
            .FirstOrDefaultAsync(ct);
        if (source is null)
        {
            return new(ScoreOutcome.NotFound);
        }

        Guid newId = Guid.CreateVersion7();
        string title = ScoreTitle.ForCopy(source.Title);
        DateTimeOffset now = clock.GetUtcNow();
        return await InsertWithinQuotaAsync(
            owner,
            new ScoreSummary(newId, title, source.SchemaVersion, 1, now, now),
            () => db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO scores (id, owner_id, title, content, schema_version, version, created_at, updated_at)
                SELECT {newId}, owner_id, {title}, jsonb_set(content, array['meta','title'], to_jsonb({title}::text)),
                       schema_version, 1, {now}, {now}
                FROM scores
                WHERE owner_id = {owner} AND id = {id}
                """,
                ct),
            ct);
    }

    public async Task<bool> DeleteAsync(Guid owner, Guid id, CancellationToken ct) =>
        await db.Scores.Where(s => s.OwnerId == owner && s.Id == id).ExecuteDeleteAsync(ct) > 0;

    private async Task<ScoreResult<ScoreSaved>> FailureAsync(Guid owner, Guid id, CancellationToken ct)
    {
        // Nothing matched: the score is missing, not owned by the caller, or has a newer version.
        bool exists = await db.Scores.AsNoTracking().AnyAsync(s => s.OwnerId == owner && s.Id == id, ct);
        return new(exists ? ScoreOutcome.Conflict : ScoreOutcome.NotFound);
    }

    private async Task<ScoreResult<ScoreSummary>> InsertWithinQuotaAsync(
        Guid owner, ScoreSummary summary, Func<Task<int>> insert, CancellationToken ct)
    {
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);

            // Serializes the creations of one user so the quota check and the insert cannot race.
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock(hashtextextended({owner.ToString()}, 0))", ct);

            if (await db.Scores.AsNoTracking().CountAsync(s => s.OwnerId == owner, ct) >= _maxScores)
            {
                return new(ScoreOutcome.QuotaExceeded);
            }

            int rows = await insert();
            if (rows == 0)
            {
                return new(ScoreOutcome.NotFound);
            }

            await transaction.CommitAsync(ct);
            return new(ScoreOutcome.Ok, summary);
        }
        catch (Exception ex) when (IsInvalidData(ex as PostgresException ?? (ex as DbUpdateException)?.InnerException as PostgresException))
        {
            return new(ScoreOutcome.InvalidContent);
        }
    }

    private static bool IsInvalidData(PostgresException? ex) =>
        // Class 22: data exception, e.g. a \u0000 or a lone surrogate that jsonb refuses.
        ex?.SqlState is "22P05" or "22P02" or "22021" or "22003";

    private static string EscapeLike(string text) =>
        text.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal);
}
