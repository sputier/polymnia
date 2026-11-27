namespace Polymnia.Core.Sharing;

/// <summary>
/// A read-only link to a score. Only the SHA-256 hash of the token is stored. A score has at most one active link
/// (<see cref="RevokedAt"/> is <c>null</c>); deleting the score deletes its links.
/// </summary>
public sealed class ShareLink
{
    public Guid Id { get; set; }

    public Guid ScoreId { get; set; }

    /// <summary>SHA-256 of the token (32 bytes), unique.</summary>
    public byte[] TokenHash { get; set; } = [];

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? RevokedAt { get; set; }
}

/// <summary>What the owner sees about the link of a score. Never the token.</summary>
public sealed record ShareStatus(bool Active, DateTimeOffset? CreatedAt);

/// <summary>Answer of the creation: the only time the raw token leaves the server.</summary>
public sealed record ShareCreated(string Token, DateTimeOffset CreatedAt);
