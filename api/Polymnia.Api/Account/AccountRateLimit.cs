using System.Globalization;
using System.Threading.RateLimiting;
using Polymnia.Core.Scores;

namespace Polymnia.Api.Account;

/// <summary>
/// Budgets of the account endpoints. The export reads every score of a user, so it is limited per user (a few
/// per ten minutes, one at a time) and all users together (a handful at once).
/// </summary>
internal sealed class AccountRateLimiters : IDisposable
{
    public const int MaxConcurrentExports = 4;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(10);

    private readonly ConcurrencyLimiter _globalExports = new(new ConcurrencyLimiterOptions { PermitLimit = MaxConcurrentExports, QueueLimit = 0 });

    public PartitionedRateLimiter<Guid> Exports { get; } = Fixed(3);

    public PartitionedRateLimiter<Guid> ExportConcurrency { get; } =
        PartitionedRateLimiter.Create<Guid, Guid>(user => RateLimitPartition.GetConcurrencyLimiter(user, _ => new ConcurrencyLimiterOptions
        {
            PermitLimit = 1,
            QueueLimit = 0,
        }));

    public PartitionedRateLimiter<Guid> Deletions { get; } = Fixed(5);

    public RateLimiter GlobalExports => _globalExports;

    private static PartitionedRateLimiter<Guid> Fixed(int permits) =>
        PartitionedRateLimiter.Create<Guid, Guid>(user => RateLimitPartition.GetFixedWindowLimiter(user, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permits,
            Window = Window,
            QueueLimit = 0,
        }));

    public void Dispose()
    {
        _globalExports.Dispose();
        Exports.Dispose();
        ExportConcurrency.Dispose();
        Deletions.Dispose();
    }
}

/// <summary>Charges one request to the signed-in user's budget; 429 with <c>Retry-After</c> when it is spent.</summary>
internal abstract class AccountRateLimitFilter : IEndpointFilter
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

        AccountRateLimiters limiters = http.RequestServices.GetRequiredService<AccountRateLimiters>();
        (RateLimitLease? first, RateLimitLease? second, RateLimitLease? third) = (null, null, null);
        try
        {
            first = await Budget(limiters).AcquireAsync(user, 1, http.RequestAborted);
            if (first.IsAcquired)
            {
                (second, third) = await Running(limiters, user, http.RequestAborted);
                if (second is null || (second.IsAcquired && third!.IsAcquired))
                {
                    return await next(context);
                }
            }

            RateLimitLease denied = !first.IsAcquired ? first : (second is { IsAcquired: false } ? second : third!);
            int retryAfter = denied.TryGetMetadata(MetadataName.RetryAfter, out TimeSpan delay)
                ? Math.Max(1, (int)Math.Ceiling(delay.TotalSeconds))
                : 60;
            http.Response.Headers.RetryAfter = retryAfter.ToString(CultureInfo.InvariantCulture);
            return Results.Problem(
                statusCode: StatusCodes.Status429TooManyRequests,
                title: "Too many requests",
                detail: "Retry after the delay in Retry-After.");
        }
        finally
        {
            first?.Dispose();
            second?.Dispose();
            third?.Dispose();
        }
    }

    protected abstract PartitionedRateLimiter<Guid> Budget(AccountRateLimiters limiters);

    /// <summary>Extra concurrency leases held while the endpoint runs; <c>null</c> when there are none.</summary>
    protected virtual ValueTask<(RateLimitLease?, RateLimitLease?)> Running(AccountRateLimiters limiters, Guid user, CancellationToken ct) =>
        ValueTask.FromResult<(RateLimitLease?, RateLimitLease?)>((null, null));

    internal sealed class Export : AccountRateLimitFilter
    {
        protected override PartitionedRateLimiter<Guid> Budget(AccountRateLimiters limiters) => limiters.Exports;

        protected override async ValueTask<(RateLimitLease?, RateLimitLease?)> Running(AccountRateLimiters limiters, Guid user, CancellationToken ct) =>
            (await limiters.ExportConcurrency.AcquireAsync(user, 1, ct), await limiters.GlobalExports.AcquireAsync(1, ct));
    }

    internal sealed class Delete : AccountRateLimitFilter
    {
        protected override PartitionedRateLimiter<Guid> Budget(AccountRateLimiters limiters) => limiters.Deletions;
    }
}
