namespace Polymnia.Core.Scores;

/// <summary>Binds the <c>Scores</c> configuration section.</summary>
public sealed class ScoreOptions
{
    public const string SectionName = "Scores";

    /// <summary>Maximum number of scores one user can own (create and duplicate are refused beyond it).</summary>
    public int MaxScoresPerUser { get; set; } = ScoreLimits.DefaultMaxScoresPerUser;
}
