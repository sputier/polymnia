using Microsoft.Extensions.Options;
using Polymnia.Core.Contact;
using Polymnia.Infrastructure.Contact;

namespace Polymnia.Api.Contact;

/// <summary>Wakes the forwarder when a message is stored, so it leaves at once instead of at the next poll.</summary>
internal sealed class ContactQueueSignal : IDisposable
{
    private readonly SemaphoreSlim _signal = new(0, 1);

    public void Notify()
    {
        try
        {
            _signal.Release();
        }
        catch (SemaphoreFullException)
        {
            // Already signalled: the forwarder will look at the queue anyway.
        }
    }

    public Task WaitAsync(TimeSpan timeout, CancellationToken ct) => _signal.WaitAsync(timeout, ct);

    public void Dispose() => _signal.Dispose();
}

/// <summary>
/// Sends the stored messages by e-mail, in the background: the request that stored a message has long been answered
/// (202). A failed message is retried with exponential backoff (<see cref="ContactStore.Backoff"/>) up to
/// <see cref="ContactStore.MaxAttempts"/> times, then left as <c>Failed</c> in the database. One message at a time, so
/// a slow SMTP server cannot pile up connections. Does nothing (and warns once) when no SMTP server is configured.
/// </summary>
internal sealed class ContactForwarder(
    IServiceScopeFactory scopes,
    IContactMailTransport transport,
    ContactQueueSignal signal,
    IOptions<ContactOptions> options,
    ILoggerFactory loggers) : BackgroundService
{
    /// <summary>How often the queue is read when nothing wakes the forwarder (retries come due, other instances store messages).</summary>
    internal static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(15);

    private readonly ILogger _logger = loggers.CreateLogger(ContactLog.Category);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.SmtpConfigured)
        {
            ContactLog.SmtpNotConfigured(_logger);
            return;
        }

        // The first pass also sends what a restart interrupted.
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await DrainAsync(stoppingToken);
                await signal.WaitAsync(PollInterval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
#pragma warning disable CA1031 // The loop must survive any failure (database down, bug): it is logged by type and retried.
            catch (Exception ex)
#pragma warning restore CA1031
            {
                ContactLog.ForwarderFailed(_logger, ex.GetType().Name);
                await DelayAsync(stoppingToken);
            }
        }
    }

    /// <summary>Sends every message that is due now. Public to the tests, which drive it without waiting for the timer.</summary>
    internal async Task DrainAsync(CancellationToken ct)
    {
        // Longer than the longest send (the transport's hard deadline), so another instance cannot take the message.
        TimeSpan lockFor = TimeSpan.FromSeconds((options.Value.SmtpTimeoutSeconds * 4L) + 30);
        int failures = 0;
        while (failures < MaxFailuresPerPass)
        {
            using IServiceScope scope = scopes.CreateScope();
            ContactStore store = scope.ServiceProvider.GetRequiredService<ContactStore>();
            ContactMessage? message = await store.ClaimNextAsync(lockFor, ct);
            if (message is null)
            {
                return;
            }

            if (!await SendOneAsync(store, message, ct))
            {
                // A hung or refusing server: do not burn the whole queue's attempts on it, look again at the next poll.
                failures++;
            }
        }
    }

    /// <summary>Consecutive failed sends after which a pass stops (the SMTP server is probably down).</summary>
    internal const int MaxFailuresPerPass = 3;

    private async Task<bool> SendOneAsync(ContactStore store, ContactMessage message, CancellationToken ct)
    {
        try
        {
            await transport.SendAsync(
                new ContactMail(message.Id, message.CreatedAt, message.Topic, message.Message, message.ReplyTo),
                ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
#pragma warning disable CA1031 // Any failure of the transport (network, TLS, SMTP answer) means "try again later".
        catch (Exception ex)
#pragma warning restore CA1031
        {
            string type = ex.GetType().Name;
            ContactStatus status = await store.MarkFailedAsync(message.Id, message.Attempts, type, ct);
            ContactLog.ForwardFailed(_logger, message.Id, type, message.Attempts, status.ToString());
            return false;
        }

        // The mail is out: recording it must not be lost to a cancellation or a blip (at-least-once delivery, see
        // docs/contact.md). A few tries, then the message is retried later, which can mean one duplicate.
        for (int i = 0; i < 3; i++)
        {
            try
            {
                if (await store.MarkSentAsync(message.Id, message.Attempts, CancellationToken.None))
                {
                    ContactLog.Forwarded(_logger, message.Id, message.Attempts);
                }

                return true;
            }
#pragma warning disable CA1031 // A database blip while recording the success: try again, then give up quietly.
            catch (Exception ex) when (i < 2)
#pragma warning restore CA1031
            {
                ContactLog.ForwarderFailed(_logger, ex.GetType().Name);
                await Task.Delay(TimeSpan.FromMilliseconds(200 * (i + 1)), CancellationToken.None);
            }
        }

        return true;
    }

    private static async Task DelayAsync(CancellationToken ct)
    {
        try
        {
            await Task.Delay(PollInterval, ct);
        }
        catch (OperationCanceledException)
        {
            // Stopping.
        }
    }
}

/// <summary>
/// Deletes the messages older than <c>Contact:RetentionDays</c>, soon after start-up and then every hour. Whatever their
/// status: a message the operator never received is not kept longer than one they did.
/// </summary>
internal sealed class ContactPurgeService(IServiceScopeFactory scopes, IOptions<ContactOptions> options, ILoggerFactory loggers) : BackgroundService
{
    internal static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    /// <summary>Gives the migrations (a separate step in the compose file) and the first requests room before the first run.</summary>
    internal static readonly TimeSpan FirstDelay = TimeSpan.FromSeconds(30);

    private readonly ILogger _logger = loggers.CreateLogger(ContactLog.Category);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(FirstDelay, stoppingToken);
            while (!stoppingToken.IsCancellationRequested)
            {
                await RunOnceAsync(stoppingToken);
                await Task.Delay(Interval, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Stopping.
        }
    }

    /// <summary>One purge. Never throws (except when cancelled): a failure is logged and the next hour tries again.</summary>
    internal async Task<int> RunOnceAsync(CancellationToken ct)
    {
        int days = options.Value.RetentionDays;
        try
        {
            using IServiceScope scope = scopes.CreateScope();
            ContactStore store = scope.ServiceProvider.GetRequiredService<ContactStore>();
            int removed = await store.PurgeAsync(TimeSpan.FromDays(days), ct);
            if (removed > 0)
            {
                ContactLog.Purged(_logger, removed, days);
            }

            return removed;
        }
#pragma warning disable CA1031 // A failed purge is retried at the next run; the type is logged, never the message.
        catch (Exception ex) when (ex is not OperationCanceledException)
#pragma warning restore CA1031
        {
            ContactLog.PurgeFailed(_logger, ex.GetType().Name);
            return 0;
        }
    }
}
