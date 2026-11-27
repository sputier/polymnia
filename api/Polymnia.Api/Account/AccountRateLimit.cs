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
        // Concurrency first, the budget last: a request refused for concurrency spends none of the budget.
        List<RateLimitLease> held = [];
        try
        {
            RateLimitLease? denied = await AcquireRunningAsync(limiters, user, held, http.RequestAborted);
            if (denied is null)
            {
                RateLimitLease budget = await Budget(limiters).AcquireAsync(user, 1, http.RequestAborted);
                held.Add(budget);
                if (budget.IsAcquired)
                {
                    return await next(context);
                }

                denied = budget;
            }

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
            foreach (RateLimitLease lease in held)
            {
                lease.Dispose();
            }
        }
    }

    protected abstract PartitionedRateLimiter<Guid> Budget(AccountRateLimiters limiters);

    /// <summary>
    /// Acquires the concurrency leases held while the endpoint runs, adding each to <paramref name="held"/> as soon as
    /// it exists (so none leaks). Returns the refused lease, or <c>null</c> when all were granted or there are none.
    /// </summary>
    protected virtual ValueTask<RateLimitLease?> AcquireRunningAsync(
        AccountRateLimiters limiters, Guid user, List<RateLimitLease> held, CancellationToken ct) =>
        ValueTask.FromResult<RateLimitLease?>(null);

    internal sealed class Export : AccountRateLimitFilter
    {
        protected override PartitionedRateLimiter<Guid> Budget(AccountRateLimiters limiters) => limiters.Exports;

        protected override async ValueTask<RateLimitLease?> AcquireRunningAsync(
            AccountRateLimiters limiters, Guid user, List<RateLimitLease> held, CancellationToken ct)
        {
            RateLimitLease perUser = await limiters.ExportConcurrency.AcquireAsync(user, 1, ct);
            held.Add(perUser);
            if (!perUser.IsAcquired)
            {
                return perUser;
            }

            RateLimitLease global = await limiters.GlobalExports.AcquireAsync(1, ct);
            held.Add(global);
            return global.IsAcquired ? null : global;
        }
    }

    internal sealed class Delete : AccountRateLimitFilter
    {
        protected override PartitionedRateLimiter<Guid> Budget(AccountRateLimiters limiters) => limiters.Deletions;
    }
}
