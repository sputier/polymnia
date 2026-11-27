using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Polymnia.Api.Auth;

namespace Polymnia.Api.Sharing;

/// <summary>Binds <c>RateLimiting:Shared</c>: the budget of the public share endpoint.</summary>
internal sealed class ShareRateLimitOptions
{
    public const string SectionName = "RateLimiting:Shared";

    /// <summary>Requests allowed per window and per client address (IPv6: per /64). A viewer makes one per page view.</summary>
    public int PermitLimit { get; set; } = 60;

    public int WindowSeconds { get; set; } = 60;

    /// <summary>Public reads streaming at the same time, all clients together (each holds a database connection).</summary>
    public int MaxConcurrentReads { get; set; } = 32;

    /// <summary>Public reads streaming at the same time for one client address: a slow reader cannot starve the others.</summary>
    public int MaxConcurrentReadsPerClient { get; set; } = 4;
}

internal static class ShareApiExtensions
{
    public static IServiceCollection AddShareApi(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<ShareRateLimitOptions>()
            .Bind(configuration.GetSection(ShareRateLimitOptions.SectionName))
            .Validate(
                static o => o.PermitLimit > 0 && o.WindowSeconds > 0 && o.MaxConcurrentReads > 0 && o.MaxConcurrentReadsPerClient > 0,
                "RateLimiting:Shared values must be positive.")
            .ValidateOnStart();

        // The endpoint is anonymous, so budgets are per client address: the IPv4 address or the IPv6 /64 (the same key
        // as the sign-in limiter); an unknown address (no socket address) shares one "unknown" key rather than being
        // unlimited. Order matters: the concurrency caps come first, so a request they refuse does not spend the
        // per-window budget of a legitimate reader. Chained after the existing global limiters; 429 and Retry-After come
        // from the shared OnRejected handler. Values are the validated options.
        services.AddOptions<RateLimiterOptions>().Configure<IOptions<ShareRateLimitOptions>>((options, shared) =>
        {
            ShareRateLimitOptions limits = shared.Value;

            PartitionedRateLimiter<HttpContext> perClientConcurrency = PartitionedRateLimiter.Create<HttpContext, string>(context =>
                IsSharedPath(context)
                    ? RateLimitPartition.GetConcurrencyLimiter("shared-conc:" + Key(context), _ => new ConcurrencyLimiterOptions
                    {
                        PermitLimit = limits.MaxConcurrentReadsPerClient,
                        QueueLimit = 0,
                    })
                    : RateLimitPartition.GetNoLimiter("other"));

            PartitionedRateLimiter<HttpContext> globalConcurrency = PartitionedRateLimiter.Create<HttpContext, string>(context =>
                IsSharedPath(context)
                    ? RateLimitPartition.GetConcurrencyLimiter("shared-reads", _ => new ConcurrencyLimiterOptions
                    {
                        PermitLimit = limits.MaxConcurrentReads,
                        QueueLimit = 0,
                    })
                    : RateLimitPartition.GetNoLimiter("other"));

            PartitionedRateLimiter<HttpContext> perClientWindow = PartitionedRateLimiter.Create<HttpContext, string>(context =>
                IsSharedPath(context)
                    ? RateLimitPartition.GetFixedWindowLimiter("shared:" + Key(context), _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = limits.PermitLimit,
                        Window = TimeSpan.FromSeconds(limits.WindowSeconds),
                        QueueLimit = 0,
                    })
                    : RateLimitPartition.GetNoLimiter("other"));

            PartitionedRateLimiter<HttpContext> chain = PartitionedRateLimiter.CreateChained(perClientConcurrency, globalConcurrency, perClientWindow);
            options.GlobalLimiter = options.GlobalLimiter is null
                ? chain
                : PartitionedRateLimiter.CreateChained(options.GlobalLimiter, chain);
        });

        return services;
    }

    private static string Key(HttpContext context) => AuthExtensions.ClientKey(context.Connection.RemoteIpAddress) ?? "unknown";

    private static bool IsSharedPath(HttpContext context) =>
        context.Request.Path.StartsWithSegments(ShareEndpoints.SharedPath, StringComparison.OrdinalIgnoreCase);
}
