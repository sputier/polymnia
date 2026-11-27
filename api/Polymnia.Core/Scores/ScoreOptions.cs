namespace Polymnia.Core.Scores;

/// <summary>Binds the <c>Scores</c> configuration section.</summary>
public sealed class ScoreOptions
{
    public const string SectionName = "Scores";

    /// <summary>Maximum number of scores one user can own (create and duplicate are refused beyond it).</summary>
    public int MaxScoresPerUser { get; set; } = ScoreLimits.DefaultMaxScoresPerUser;

    /// <summary>
    /// Maximum total size of the score content one user can store, in bytes (PostgreSQL-stored size, so compressed
    /// content counts for what it takes on disk). Creating, duplicating or saving beyond it is refused with 413.
    /// </summary>
    public long MaxStorageBytesPerUser { get; set; } = ScoreLimits.DefaultMaxStorageBytesPerUser;
}
