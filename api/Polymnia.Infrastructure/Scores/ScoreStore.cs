using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;
using NpgsqlTypes;
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
        List<ScoreSummary> rows = await query
            .OrderByDescending(s => s.UpdatedAt)
            .ThenByDescending(s => s.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(s => new ScoreSummary(s.Id, s.Title, s.SchemaVersion, s.Version, s.CreatedAt, s.UpdatedAt))
            .ToListAsync(ct);

        // The preview (measure count, instruments) is read from the content of the rows of this page only, never of
        // the whole library, and only a few bytes per score leave the database.
        Dictionary<Guid, PreviewRow> previews = [];
        if (rows.Count > 0)
        {
            Guid[] ids = [.. rows.Select(r => r.Id)];
            List<PreviewRow> found = await db.Database
                .SqlQuery<PreviewRow>(
                    $"""
                    SELECT id AS "Id",
                           COALESCE((jsonb_path_query_first(content, '$.measures.size()'))::int, 0) AS "MeasureCount",
                           ARRAY(SELECT jsonb_array_elements_text(jsonb_path_query_array(content, '$.parts[*].instrument'))) AS "Instruments"
                    FROM scores
                    WHERE owner_id = {owner} AND id = ANY({ids})
                    """)
                .ToListAsync(ct);
            previews = found.ToDictionary(p => p.Id);
        }

        List<ScoreListItem> items = [.. rows.Select(r =>
        {
            previews.TryGetValue(r.Id, out PreviewRow? preview);
            return new ScoreListItem(
                r.Id, r.Title, r.SchemaVersion, r.Version, r.CreatedAt, r.UpdatedAt,
                preview?.MeasureCount ?? 0, preview?.Instruments ?? []);
        })];
        return new ScorePage(items, page, pageSize, total);
    }

    // Result of the preview query: column aliases are the property names.
    private sealed record PreviewRow(Guid Id, int MeasureCount, string[] Instruments);

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

        return await OpenContentAsync(
            "SELECT version, convert_to(content::text, 'UTF8') FROM scores WHERE owner_id = $1 AND id = $2",
            [owner, id],
            ct);
    }

    /// <summary>
    /// The content of the score behind an active share link, found by the SHA-256 hash of its token. Revoked or unknown:
    /// <see cref="ScoreOutcome.NotFound"/>. No owner is involved: the token is the only credential.
    /// </summary>
    public Task<ScoreResult<ScoreContent>> OpenSharedContentAsync(byte[] tokenHash, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(tokenHash);
        return OpenContentAsync(
            """
            SELECT s.version, convert_to(s.content::text, 'UTF8')
            FROM share_links l JOIN scores s ON s.id = l.score_id
            WHERE l.token_hash = $1 AND l.revoked_at IS NULL
            """,
            [tokenHash],
            ct);
    }

    // The document goes from PostgreSQL to the response as bytes: no 2 MB UTF-16 string on the large object heap.
    private async Task<ScoreResult<ScoreContent>> OpenContentAsync(string sql, object[] values, CancellationToken ct)
    {
        await db.Database.OpenConnectionAsync(ct);
        NpgsqlCommand? command = null;
        System.Data.Common.DbDataReader? reader = null;
        try
        {
            command = new NpgsqlCommand(sql, (NpgsqlConnection)db.Database.GetDbConnection());
            foreach (object value in values)
            {
                command.Parameters.Add(new NpgsqlParameter { Value = value });
            }

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
            try
            {
                await ReleaseAsync(reader, command);
            }
            catch (Exception releaseError) when (releaseError is not OperationCanceledException)
            {
                // Keep the original exception.
            }

            throw;
        }
    }

    private async ValueTask ReleaseAsync(System.Data.Common.DbDataReader? reader, NpgsqlCommand? command)
    {
        try
        {
            try
            {
                if (reader is not null)
                {
                    await reader.DisposeAsync();
                }
            }
            finally
            {
                if (command is not null)
                {
                    await command.DisposeAsync();
                }
            }
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
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

    /// <summary>
    /// Applies a validated patch (see <see cref="ScorePatchPlanner"/>) to the stored document at version
    /// <paramref name="expectedVersion"/>. The document never leaves PostgreSQL: one small query reads its shape
    /// (ids and counts), the planner turns the patch into jsonb edits, and one conditional <c>UPDATE</c> applies them,
    /// so two concurrent patches (or a patch and a full save) at the same version cannot both succeed.
    /// </summary>
    public async Task<ScoreResult<ScoreSaved>> PatchContentAsync(
        Guid owner, Guid id, long expectedVersion, ScorePatch patch, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(patch);

        // The shape (ids and counts, a few KB) is read with five jsonpath calls: they do not copy the nodes they
        // walk, unlike jsonb_array_elements over the parts (measured: 3 ms against 9 ms for a 1 MB score). It is
        // only computed when the version is the expected one.
        ShapeRow? row = (await db.Database
            .SqlQuery<ShapeRow>(
                $"""
                SELECT version AS "Version",
                       CASE WHEN version = {expectedVersion} THEN jsonb_path_query_array(content, '$.measures[*].id')::text END AS "Measures",
                       CASE WHEN version = {expectedVersion} THEN jsonb_path_query_array(content, '$.parts[*].id')::text END AS "PartIds",
                       CASE WHEN version = {expectedVersion} THEN jsonb_path_query_array(content, '$.parts[*].staves.size()')::text END AS "StaffCounts",
                       CASE WHEN version = {expectedVersion} THEN jsonb_path_query_array(content, '$.parts[*].staves[*].id')::text END AS "StaffIds",
                       CASE WHEN version = {expectedVersion} THEN jsonb_path_query_array(content, '$.parts[*].staves[*].measures.size()')::text END AS "StaffMeasureCounts"
                FROM scores
                WHERE owner_id = {owner} AND id = {id}
                """)
            .ToListAsync(ct)).FirstOrDefault();
        if (row is null)
        {
            return new(ScoreOutcome.NotFound);
        }

        if (row.Version != expectedVersion)
        {
            return new(ScoreOutcome.Conflict);
        }

        ScoreShape shape;
        try
        {
            shape = ScoreShape.FromJson(row.Measures!, row.PartIds!, row.StaffCounts!, row.StaffIds!, row.StaffMeasureCounts!);
        }
        catch (InvalidOperationException)
        {
            return new(ScoreOutcome.InvalidPatch, Error: "The stored score has an unexpected structure: send the full document.");
        }

        PatchPlan plan = ScorePatchPlanner.Plan(shape, patch);
        if (!plan.IsValid)
        {
            return new(ScoreOutcome.InvalidPatch, Error: plan.Error);
        }

        DateTimeOffset now = clock.GetUtcNow();
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            await using NpgsqlCommand command = new() { Connection = (NpgsqlConnection)db.Database.GetDbConnection() };
            command.CommandTimeout = 10;
            command.CommandText = PatchSql(plan, command.Parameters, owner, id, expectedVersion, now);

            string? title = null;
            int schemaVersion = 0;
            await using (System.Data.Common.DbDataReader reader = await command.ExecuteReaderAsync(ct))
            {
                if (await reader.ReadAsync(ct))
                {
                    title = reader.GetString(0);
                    schemaVersion = reader.GetInt32(1);
                }
            }

            if (title is not null)
            {
                return new(ScoreOutcome.Ok, new ScoreSaved(id, title, schemaVersion, expectedVersion + 1, now));
            }
        }
        catch (PostgresException ex) when (IsInvalidData(ex))
        {
            return new(ScoreOutcome.InvalidContent);
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }

        // Nothing was updated: a concurrent change, or the patched document would be too large.
        long? current = await db.Scores.AsNoTracking()
            .Where(s => s.OwnerId == owner && s.Id == id)
            .Select(s => (long?)s.Version)
            .FirstOrDefaultAsync(ct);
        return current is null
            ? new(ScoreOutcome.NotFound)
            : new(current == expectedVersion ? ScoreOutcome.TooLarge : ScoreOutcome.Conflict);
    }

    private sealed record ShapeRow(long Version, string? Measures, string? PartIds, string? StaffCounts, string? StaffIds, string? StaffMeasureCounts);

    // Replacements of one measure (a MeasureInfo, or a measure of a staff): paths that no other kind of edit overlaps.
    private static bool Groupable(Edit edit) =>
        edit.Kind == EditKind.Set
        && ((edit.Path[0] == "measures" && edit.Path.Length == 2) || (edit.Path[0] == "parts" && edit.Path.Length > 2));

    // The SQL text only ever contains numbers and constants; every value (ids, paths, fragments) is a parameter.
    private static string PatchSql(
        PatchPlan plan, NpgsqlParameterCollection parameters, Guid owner, Guid id, long expectedVersion, DateTimeOffset now)
    {
        parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Uuid, Value = owner });
        parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Uuid, Value = id });
        parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Bigint, Value = expectedVersion });
        parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.TimestampTz, Value = now });
        parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)plan.Title ?? DBNull.Value });

        // One CTE per stage; each rewrites the document once. jsonb_set copies the whole document (about 15 ms per
        // megabyte), so consecutive replacements inside the same array are applied to that array alone and put back
        // with a single rewrite of the document.
        List<string> stages =
        [
            "s0 AS MATERIALIZED (SELECT content AS c FROM scores WHERE owner_id = $1 AND id = $2 AND version = $3)",
        ];
        string Param(NpgsqlDbType type, object value)
        {
            parameters.Add(new NpgsqlParameter { NpgsqlDbType = type, Value = value });
            return $"${parameters.Count}";
        }

        string PathParam(string[] path) => Param(NpgsqlDbType.Array | NpgsqlDbType.Text, path) + "::text[]";
        string JsonParam(string json) => Param(NpgsqlDbType.Jsonb, json) + "::jsonb";

        void Stage(Func<string, string> rewrite)
        {
            string previous = $"s{stages.Count - 1}.c";
            stages.Add($"s{stages.Count} AS MATERIALIZED (SELECT {rewrite(previous)} AS c FROM s{stages.Count - 1})");
        }

        IReadOnlyList<Edit> edits = plan.Edits;
        for (int i = 0; i < edits.Count;)
        {
            if (!Groupable(edits[i]))
            {
                Edit edit = edits[i++];
                string path = PathParam(edit.Path);
                if (edit.Kind == EditKind.Delete)
                {
                    Stage(c => $"{c} #- {path}");
                }
                else
                {
                    string value = JsonParam(edit.Json!);
                    string call = edit.Kind switch
                    {
                        EditKind.Set => "jsonb_set({0}, {1}, {2}, false)",
                        EditKind.Insert => "jsonb_insert({0}, {1}, {2}, false)",
                        _ => "jsonb_insert({0}, {1}, {2}, true)",
                    };
                    Stage(c => string.Format(System.Globalization.CultureInfo.InvariantCulture, call, c, path, value));
                }

                continue;
            }

            // A run of replacements of measures: group them by the array that holds them (the path without its
            // last index). A replacement of a whole part is never grouped, it could overlap the others.
            int end = i;
            while (end < edits.Count && Groupable(edits[end]))
            {
                end++;
            }

            foreach (IGrouping<string, Edit> group in edits.Skip(i).Take(end - i).GroupBy(e => string.Join('/', e.Path[..^1])))
            {
                Edit[] sets = [.. group];
                if (sets.Length == 1 || sets[0].Path.Length < 2)
                {
                    foreach (Edit set in sets)
                    {
                        string path = PathParam(set.Path);
                        string value = JsonParam(set.Json!);
                        Stage(c => $"jsonb_set({c}, {path}, {value}, false)");
                    }

                    continue;
                }

                string container = PathParam(sets[0].Path[..^1]);
                Stage(c =>
                {
                    string inner = $"({c} #> {container})";
                    foreach (Edit set in sets)
                    {
                        inner = $"jsonb_set({inner}, {PathParam([set.Path[^1]])}, {JsonParam(set.Json!)}, false)";
                    }

                    return $"jsonb_set({c}, {container}, {inner}, false)";
                });
            }

            i = end;
        }

        // pg_column_size of a fresh jsonb is its binary size, known without serializing it.
        return $"""
            WITH {string.Join(",\n     ", stages)}
            UPDATE scores s
            SET content = p.c,
                title = COALESCE($5, s.title),
                version = s.version + 1,
                updated_at = $4
            FROM s{stages.Count - 1} p
            WHERE s.owner_id = $1 AND s.id = $2 AND s.version = $3
              AND pg_column_size(p.c) <= {ScoreLimits.MaxStoredContentBytes}
            RETURNING s.title, s.schema_version
            """;
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
