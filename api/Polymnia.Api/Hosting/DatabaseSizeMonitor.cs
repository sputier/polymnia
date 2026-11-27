using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Polymnia.Infrastructure;

namespace Polymnia.Api.Hosting;

/// <summary>Binds <c>Monitoring</c>: the operator alert on the size of the database.</summary>
internal sealed class MonitoringOptions
{
    public const string SectionName = "Monitoring";

    /// <summary>Total database size, in bytes, above which a warning is logged (at start-up, then every hour). 0 disables it.</summary>
    public long DatabaseSizeWarningBytes { get; set; } = 5L * 1024 * 1024 * 1024;
}

/// <summary>
/// Operator alert: when the database outgrows <see cref="MonitoringOptions.DatabaseSizeWarningBytes"/> a warning is logged
/// at start-up and then every hour, so abuse or growth is noticed before the disk is full. Only sizes are logged.
/// A measurement that fails is logged as a warning (it is retried every hour): without it the alert would be silent.
/// </summary>
internal sealed partial class DatabaseSizeMonitor(
    IServiceScopeFactory scopes,
    IOptions<MonitoringOptions> options,
    TimeProvider time,
    ILogger<DatabaseSizeMonitor> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    /// <summary>Measures once. Returns the size in bytes, or <c>null</c> when disabled or not measurable.</summary>
    internal async Task<long?> CheckAsync(CancellationToken ct)
    {
        long threshold = options.Value.DatabaseSizeWarningBytes;
        if (threshold <= 0)
        {
            return null;
        }

        try
        {
            await using AsyncServiceScope scope = scopes.CreateAsyncScope();
            PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
            long size = (await db.Database
                .SqlQuery<long>($"SELECT pg_database_size(current_database())::bigint AS \"Value\"")
                .ToListAsync(ct))[0];
            if (size > threshold)
            {
                SizeExceeded(logger, size, threshold);
            }

            return size;
        }
#pragma warning disable CA1031 // A failed measurement must never stop the host; it is retried at the next tick.
        catch (Exception ex) when (!ct.IsCancellationRequested)
#pragma warning restore CA1031
        {
            string failure = ex.GetType().Name;
            NotMeasured(logger, failure);
            return null;
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await CheckAsync(stoppingToken);
        using var timer = new PeriodicTimer(Interval, time);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await CheckAsync(stoppingToken);
        }
    }

    [LoggerMessage(EventId = 40, EventName = "DatabaseSizeExceeded", Level = LogLevel.Warning,
        Message = "The database takes {SizeBytes} bytes, above the warning threshold of {ThresholdBytes} bytes (Monitoring:DatabaseSizeWarningBytes). Check disk space, the number of accounts and the storage quota (Scores:MaxStorageBytesPerUser).")]
    private static partial void SizeExceeded(ILogger logger, long sizeBytes, long thresholdBytes);

    [LoggerMessage(EventId = 41, EventName = "DatabaseSizeNotMeasured", Level = LogLevel.Warning, Message = "The database size could not be measured ({FailureType}).")]
    private static partial void NotMeasured(ILogger logger, string failureType);
}
