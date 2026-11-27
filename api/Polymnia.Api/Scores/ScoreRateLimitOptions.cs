namespace Polymnia.Api.Scores;

/// <summary>Binds <c>RateLimiting:ScoreWrites</c>: the per-user budget of the score write endpoints.</summary>
internal sealed class ScoreRateLimitOptions
{
    public const string SectionName = "RateLimiting:ScoreWrites";

    /// <summary>Reads (list, get) allowed per window and per user: generous, it only stops scraping and floods.</summary>
    public int ReadPermitLimit { get; set; } = 600;

    /// <summary>Writes allowed per window and per user (an editor that autosaves every few seconds stays far below).</summary>
    public int PermitLimit { get; set; } = 120;

    /// <summary>Score writes running at the same time, all users together (each holds several MB while it runs).</summary>
    public int MaxConcurrentWrites { get; set; } = 16;

    public int WindowSeconds { get; set; } = 60;
}
