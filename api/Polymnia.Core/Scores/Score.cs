namespace Polymnia.Core.Scores;

/// <summary>A stored score. <see cref="Content"/> is the score JSON document (PostgreSQL <c>jsonb</c>).</summary>
public sealed class Score
{
    public Guid Id { get; set; }

    /// <summary>The owner: foreign key to <c>users.id</c>, cascade delete.</summary>
    public Guid OwnerId { get; set; }

    public string Title { get; set; } = string.Empty;

    public string Content { get; set; } = "{}";

    public int SchemaVersion { get; set; }

    /// <summary>Optimistic concurrency token, incremented on every change. It is the ETag of the score.</summary>
    public long Version { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
