namespace Polymnia.Api.Contact;

/// <summary>
/// Lets one log line through per window and counts the others, so that a flood of refused requests (robots, rate limits)
/// writes one aggregated line per window instead of one per request and cannot fill the disk. The line reports how many
/// events it stands for.
/// </summary>
internal sealed class ContactLogThrottle(TimeSpan window, TimeProvider clock)
{
    private readonly Lock _gate = new();
    private DateTimeOffset _next = DateTimeOffset.MinValue;
    private int _pending;

    /// <summary>Counts one event. Returns <c>true</c>, with the number of events since the last line, when a line is due.</summary>
    public bool TryLog(out int count)
    {
        lock (_gate)
        {
            _pending++;
            DateTimeOffset now = clock.GetUtcNow();
            if (now < _next)
            {
                count = 0;
                return false;
            }

            _next = now + window;
            count = _pending;
            _pending = 0;
            return true;
        }
    }
}

/// <summary>The throttles of the contact form's log lines (one per kind of event).</summary>
internal sealed class ContactLogThrottles()
{
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    // Real time, not the injectable clock: a log window is about the wall clock of the process.
    public ContactLogThrottle Honeypot { get; } = new(Window, TimeProvider.System);

    public ContactLogThrottle RateLimit { get; } = new(Window, TimeProvider.System);
}
