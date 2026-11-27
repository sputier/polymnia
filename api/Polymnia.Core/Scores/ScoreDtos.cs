namespace Polymnia.Core.Scores;

/// <summary>What the list returns: never the content.</summary>
public sealed record ScoreSummary(
    Guid Id, string Title, int SchemaVersion, long Version, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

/// <summary>What a content update or a rename returns.</summary>
public sealed record ScoreSaved(Guid Id, string Title, int SchemaVersion, long Version, DateTimeOffset UpdatedAt);

/// <summary>
/// One row of the list: the summary plus a cheap preview computed from the content (number of measures and the
/// instrument id of each part). The content itself is never returned.
/// </summary>
public sealed record ScoreListItem(
    Guid Id,
    string Title,
    int SchemaVersion,
    long Version,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int MeasureCount,
    IReadOnlyList<string> Instruments);

public sealed record ScorePage(IReadOnlyList<ScoreListItem> Items, int Page, int PageSize, int Total);

/// <summary>A validated score document, ready to store.</summary>
public sealed record ScoreDocument(string Json, string Title, int SchemaVersion);

/// <summary>Result of validating a raw score body.</summary>
public sealed record ScoreValidationResult(ScoreDocument? Document, string? Error)
{
    public bool IsValid => Document is not null;
}

/// <summary>Validates a raw score body: JSON syntax, <c>schemaVersion</c>, JSON Schema, title.</summary>
public interface IScoreContentValidator
{
    ScoreValidationResult Validate(ReadOnlyMemory<byte> utf8Json);
}

public enum ScoreOutcome
{
    Ok,
    NotFound,
    Conflict,
    QuotaExceeded,
    InvalidContent,

    /// <summary>A patch that cannot be applied to the stored document (unknown id, inconsistent structure, limit).</summary>
    InvalidPatch,

    /// <summary>The patched document would be larger than a full save accepts.</summary>
    TooLarge,
}

public sealed record ScoreResult<T>(ScoreOutcome Outcome, T? Value = default, string? Error = null)
{
    public bool IsOk => Outcome == ScoreOutcome.Ok;
}

/// <summary>
/// Stored content of a score for GET. <see cref="Body"/> is the UTF-8 JSON, streamed from the database (never a .NET
/// string); it is <c>null</c> when the caller's copy is current. Dispose <see cref="Lease"/> when done with the body.
/// </summary>
public sealed record ScoreContent(long Version, Stream? Body, IAsyncDisposable? Lease);
