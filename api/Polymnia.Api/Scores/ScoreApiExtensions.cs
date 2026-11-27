using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Polymnia.Core.Scores;

namespace Polymnia.Api.Scores;

internal static class ScoreApiExtensions
{
    public static IServiceCollection AddScoreApi(
        this IServiceCollection services, IConfiguration configuration, IWebHostEnvironment environment)
    {
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, HttpCurrentUser>();

        // Clients may send a gzip or Brotli body. The score endpoints cap the DECOMPRESSED size (BoundedBody).
        services.AddRequestDecompression();

        services.AddOptions<Polymnia.Core.Scores.ScoreOptions>()
            .Bind(configuration.GetSection(Polymnia.Core.Scores.ScoreOptions.SectionName))
            .Validate(static o => o.MaxScoresPerUser > 0 && o.MaxStorageBytesPerUser > 0, "Scores:MaxScoresPerUser and Scores:MaxStorageBytesPerUser must be positive.")
            .ValidateOnStart();

        services.AddOptions<ScoreRateLimitOptions>()
            .Bind(configuration.GetSection(ScoreRateLimitOptions.SectionName))
            .Validate(static o => o.PermitLimit > 0 && o.ReadPermitLimit > 0 && o.WindowSeconds > 0 && o.MaxConcurrentWrites > 0, "RateLimiting:ScoreWrites values must be positive.")
            .ValidateOnStart();

        ScoreRateLimitOptions limits = configuration.GetSection(ScoreRateLimitOptions.SectionName).Get<ScoreRateLimitOptions>() ?? new();
        // The per-user budgets are endpoint filters (ScoreRateLimitFilter): the rate limiter middleware runs before
        // authentication, so it cannot know the user.
        services.AddSingleton(new ScoreRateLimiters(limits));

        // Writes carry up to a few MB each: cap how many run at once, all users together. Chained after the
        // existing global limiter.
        PartitionedRateLimiter<HttpContext> concurrency = PartitionedRateLimiter.Create<HttpContext, string>(context =>
            HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method)
                || !context.Request.Path.StartsWithSegments("/api/scores", StringComparison.OrdinalIgnoreCase)
                ? RateLimitPartition.GetNoLimiter("other")
                : RateLimitPartition.GetConcurrencyLimiter("score-writes", _ => new ConcurrencyLimiterOptions
                {
                    PermitLimit = limits.MaxConcurrentWrites,
                    QueueLimit = 0,
                }));
        services.PostConfigure<RateLimiterOptions>(options => options.GlobalLimiter = options.GlobalLimiter is null
            ? concurrency
            : PartitionedRateLimiter.CreateChained(options.GlobalLimiter, concurrency));

        // The OpenAPI document describes every route: it is published in Development only.
        if (environment.IsDevelopment())
        {
            services.AddOpenApi();
        }

        return services;
    }

    /// <summary>Request decompression (authentication, rate limiting and authorization come from the sign-in feature).</summary>
    public static WebApplication UseScoreApi(this WebApplication app)
    {
        app.UseCompressedBodyPolicy();
        app.UseRequestDecompression();
        return app;
    }

    public static WebApplication MapScoreApi(this WebApplication app)
    {
        app.MapScoreEndpoints();
        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
        }

        return app;
    }
}
