using System.Globalization;
using System.Threading.RateLimiting;
using Polymnia.Core.Scores;

namespace Polymnia.Api.Scores;

/// <summary>The per-user budgets of the score endpoints (one fixed window per user, separate for reads and writes).</summary>
internal sealed class ScoreRateLimiters
{
    public ScoreRateLimiters(ScoreRateLimitOptions options)
    {
        Writes = Create(options.PermitLimit, options.WindowSeconds);
        Reads = Create(options.ReadPermitLimit, options.WindowSeconds);
        PermitLimit = options.PermitLimit;
        WriteConcurrency = Concurrent(2);
        ReadConcurrency = Concurrent(4);
    }

    /// <summary>Requests of one user running at the same time (a slow client must not pin connections or buffers).</summary>
    public PartitionedRateLimiter<Guid> WriteConcurrency { get; }

    public PartitionedRateLimiter<Guid> ReadConcurrency { get; }

    private static PartitionedRateLimiter<Guid> Concurrent(int permits) =>
        PartitionedRateLimiter.Create<Guid, Guid>(user => RateLimitPartition.GetConcurrencyLimiter(user, _ => new ConcurrencyLimiterOptions
        {
            PermitLimit = permits,
            QueueLimit = 0,
        }));

    public int PermitLimit { get; }

    public PartitionedRateLimiter<Guid> Writes { get; }

    public PartitionedRateLimiter<Guid> Reads { get; }

    private static PartitionedRateLimiter<Guid> Create(int permits, int windowSeconds) =>
        PartitionedRateLimiter.Create<Guid, Guid>(user => RateLimitPartition.GetFixedWindowLimiter(user, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permits,
            Window = TimeSpan.FromSeconds(windowSeconds),
            QueueLimit = 0,
        }));
}

/// <summary>
/// Endpoint filter that charges one request to the signed-in user's budget. It runs after authentication and
/// authorization (a middleware-level limiter runs before them and cannot tell users apart): 429 with
/// <c>Retry-After</c> when the budget is spent.
/// </summary>
internal abstract class ScoreRateLimitFilter(bool writes) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        HttpContext http = context.HttpContext;
        if (http.RequestServices.GetRequiredService<ICurrentUser>().UserId is not { } user)
        {
            return Results.Unauthorized();
        }

        ScoreRateLimiters limiters = http.RequestServices.GetRequiredService<ScoreRateLimiters>();
        using RateLimitLease lease = await (writes ? limiters.Writes : limiters.Reads).AcquireAsync(user, 1, http.RequestAborted);
        if (lease.IsAcquired)
        {
            using RateLimitLease running = await (writes ? limiters.WriteConcurrency : limiters.ReadConcurrency).AcquireAsync(user, 1, http.RequestAborted);
            if (running.IsAcquired)
            {
                return await next(context);
            }
        }

        int retryAfter = lease.TryGetMetadata(MetadataName.RetryAfter, out TimeSpan delay)
            ? Math.Max(1, (int)Math.Ceiling(delay.TotalSeconds))
            : 60;
        http.Response.Headers.RetryAfter = retryAfter.ToString(CultureInfo.InvariantCulture);
        return Results.Problem(
            statusCode: StatusCodes.Status429TooManyRequests,
            title: "Too many requests",
            detail: "Slow down and retry after the delay in Retry-After.");
    }

    internal sealed class Writes() : ScoreRateLimitFilter(true);

    internal sealed class Reads() : ScoreRateLimitFilter(false);
}
