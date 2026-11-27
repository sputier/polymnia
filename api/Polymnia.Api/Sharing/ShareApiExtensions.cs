using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
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
}

internal static class ShareApiExtensions
{
    public static IServiceCollection AddShareApi(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<ShareRateLimitOptions>()
            .Bind(configuration.GetSection(ShareRateLimitOptions.SectionName))
            .Validate(static o => o.PermitLimit > 0 && o.WindowSeconds > 0 && o.MaxConcurrentReads > 0, "RateLimiting:Shared values must be positive.")
            .ValidateOnStart();

        ShareRateLimitOptions limits = configuration.GetSection(ShareRateLimitOptions.SectionName).Get<ShareRateLimitOptions>() ?? new();

        // The endpoint is anonymous, so the budget is per client address: the IPv4 address or the IPv6 /64 (the same
        // key as the sign-in limiter). Unknown and valid tokens, and any method, share it, so it also slows token
        // guessing (which 256 random bits make pointless anyway). Chained after the existing global limiters; 429 and
        // Retry-After come from the shared OnRejected handler.
        PartitionedRateLimiter<HttpContext> perClient = PartitionedRateLimiter.Create<HttpContext, string>(context =>
            IsSharedPath(context) && AuthExtensions.ClientKey(context.Connection.RemoteIpAddress) is { } key
                ? RateLimitPartition.GetFixedWindowLimiter("shared:" + key, _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = limits.PermitLimit,
                    Window = TimeSpan.FromSeconds(limits.WindowSeconds),
                    QueueLimit = 0,
                })
                : RateLimitPartition.GetNoLimiter("other"));

        PartitionedRateLimiter<HttpContext> concurrency = PartitionedRateLimiter.Create<HttpContext, string>(context =>
            IsSharedPath(context)
                ? RateLimitPartition.GetConcurrencyLimiter("shared-reads", _ => new ConcurrencyLimiterOptions
                {
                    PermitLimit = limits.MaxConcurrentReads,
                    QueueLimit = 0,
                })
                : RateLimitPartition.GetNoLimiter("other"));

        services.PostConfigure<RateLimiterOptions>(options => options.GlobalLimiter = options.GlobalLimiter is null
            ? PartitionedRateLimiter.CreateChained(perClient, concurrency)
            : PartitionedRateLimiter.CreateChained(options.GlobalLimiter, perClient, concurrency));

        return services;
    }

    private static bool IsSharedPath(HttpContext context) =>
        context.Request.Path.StartsWithSegments(ShareEndpoints.SharedPath, StringComparison.OrdinalIgnoreCase);
}
