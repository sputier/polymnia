namespace Polymnia.Core.Scores;

/// <summary>Size limits of the score API. They must stay coherent with <c>schema/score.v1.schema.json</c>.</summary>
public static class ScoreLimits
{
    /// <summary>
    /// Maximum request body for a score, in bytes. A 500-measure, 4-staff score is about 1 MB of JSON; the schema
    /// allows 2000 measures, which is about 4 MB for the same density, so 4 MiB covers the schema maximum at that density
    /// and still bounds memory use, validation time and storage per request.
    /// </summary>
    public const int MaxContentBytes = 4 * 1024 * 1024;

    /// <summary>Maximum title length, in Unicode code points (same as <c>meta.title</c> in the schema).</summary>
    public const int MaxTitleLength = 200;

    /// <summary>Maximum title length, in UTF-16 units: the database column size (a code point is at most 2 units).</summary>
    public const int MaxTitleColumnLength = MaxTitleLength * 2;

    /// <summary>
    /// Maximum request body of an incremental update (<c>PATCH /api/scores/{id}/content</c>), in bytes, after
    /// decompression. A typical autosave batch is a few KB; the client sends the full document above 256 KB anyway.
    /// </summary>
    public const int MaxPatchBytes = 1024 * 1024;

    /// <summary>Maximum number of operations in one patch.</summary>
    public const int MaxPatchOps = 64;

    /// <summary>
    /// Maximum number of document edits one patch expands to (an inserted measure costs one per staff). Every edit
    /// rewrites the stored document inside PostgreSQL, so this bounds the work of one request.
    /// </summary>
    public const int MaxPatchEdits = 64;

    /// <summary>Default maximum number of scores one user can own.</summary>
    public const int DefaultMaxScoresPerUser = 200;

    public const int DefaultPageSize = 20;

    public const int MaxPageSize = 100;

    /// <summary>Maximum length of the <c>q</c> search text, in characters.</summary>
    public const int MaxSearchLength = 100;

    /// <summary>Maximum JSON nesting depth accepted for a score (the schema needs about 12).</summary>
    public const int MaxJsonDepth = 32;
}
