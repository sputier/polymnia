using Microsoft.Extensions.Diagnostics.HealthChecks;
using Polymnia.Infrastructure;

namespace Polymnia.Api.Hosting;

/// <summary>
/// Readiness probe. Reports only healthy or unhealthy: no connection detail ever reaches the response.
/// The endpoint is public, so the result is cached for a few seconds: anonymous callers cannot make
/// the API open a database connection per request.
/// </summary>
internal sealed partial class DatabaseHealthCheck(
    IServiceScopeFactory scopeFactory,
    ILogger<DatabaseHealthCheck> logger,
    TimeProvider timeProvider) : IHealthCheck, IDisposable
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(5);

    private readonly SemaphoreSlim _gate = new(1, 1);
    private HealthStatus _cachedStatus;
    private DateTimeOffset _cachedUntil = DateTimeOffset.MinValue;

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        if (TryGetCached(out HealthCheckResult cached))
        {
            return cached;
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            // Another caller may have refreshed the cache while this one waited.
            if (TryGetCached(out cached))
            {
                return cached;
            }

            HealthStatus status = await ProbeAsync(cancellationToken);
            _cachedStatus = status;
            _cachedUntil = timeProvider.GetUtcNow() + CacheDuration;
            return new HealthCheckResult(status);
        }
        finally
        {
            _gate.Release();
        }
    }

    public void Dispose() => _gate.Dispose();

    private bool TryGetCached(out HealthCheckResult result)
    {
        if (timeProvider.GetUtcNow() < _cachedUntil)
        {
            result = new HealthCheckResult(_cachedStatus);
            return true;
        }

        result = default;
        return false;
    }

    private async Task<HealthStatus> ProbeAsync(CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);

        try
        {
            await using AsyncServiceScope scope = scopeFactory.CreateAsyncScope();
            PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
            return await db.Database.CanConnectAsync(timeout.Token) ? HealthStatus.Healthy : HealthStatus.Unhealthy;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            LogTimeout(logger);
            return HealthStatus.Unhealthy;
        }
#pragma warning disable CA1031 // A readiness probe must never throw; the failure is logged server-side.
        catch (Exception ex) when (ex is not OperationCanceledException)
#pragma warning restore CA1031
        {
            LogFailure(logger, ex.GetType().Name);
            return HealthStatus.Unhealthy;
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Database readiness check timed out.")]
    private static partial void LogTimeout(ILogger logger);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Database readiness check failed ({ExceptionType}).")]
    private static partial void LogFailure(ILogger logger, string exceptionType);
}
