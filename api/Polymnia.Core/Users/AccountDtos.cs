namespace Polymnia.Core.Users;

/// <summary>One server-side session of a user, as listed in the data export (the key hash and ticket are never exported).</summary>
public sealed record SessionInfo(DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, DateTimeOffset AbsoluteExpiresAt);

/// <summary>Everything stored about a user besides the scores: the data of the export's <c>profile.json</c>.</summary>
public sealed record AccountProfile(
    Guid Id,
    string GoogleSubject,
    string DisplayName,
    string? AvatarUrl,
    string? PreferredLanguage,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastSeenAt,
    IReadOnlyList<SessionInfo> Sessions,
    IReadOnlyList<ShareLinkInfo> ShareLinks);

/// <summary>A share link of one of the user's scores, as listed in the export: dates only, never the token or its hash.</summary>
public sealed record ShareLinkInfo(Guid ScoreId, DateTimeOffset CreatedAt, DateTimeOffset? RevokedAt);

/// <summary>Metadata of one score of the export (the content is streamed separately).</summary>
public sealed record ScoreExportRow(
    Guid Id, string Title, int SchemaVersion, long Version, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
