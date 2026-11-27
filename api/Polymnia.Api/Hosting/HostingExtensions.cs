using System.Net;
using System.IO.Compression;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Polymnia.Api.Spa;

namespace Polymnia.Api.Hosting;

internal static class HostingExtensions
{
    private static readonly string[] CompressedMimeTypes =
    [
        "image/svg+xml",
        "application/manifest+json",
        "application/problem+json",
        "application/wasm",
    ];

    public static IServiceCollection AddPolymniaHosting(
        this IServiceCollection services,
        IConfiguration configuration,
        IWebHostEnvironment environment)
    {
        services.AddOptions<SecurityOptions>()
            .Bind(configuration.GetSection(SecurityOptions.SectionName))
            .Validate(static o => !string.IsNullOrWhiteSpace(o.ContentSecurityPolicy), "Security:ContentSecurityPolicy must not be empty.")
            .ValidateOnStart();

        services.AddProblemDetails();

        if (!environment.IsDevelopment())
        {
            services.AddHsts(options =>
            {
                options.MaxAge = TimeSpan.FromDays(365);
                options.IncludeSubDomains = false;
                options.Preload = false;
            });
        }

        // BREACH mitigation rule: a response that contains a secret or a token must never be compressed.
        // Such endpoints carry [DisableResponseCompression] / .DisableResponseCompression(), enforced by
        // EndpointAwareCompressionProvider. Antiforgery uses the cookie + header pattern, never tokens in bodies.
        services.AddResponseCompression(options =>
        {
            options.EnableForHttps = true;
            options.Providers.Add<BrotliCompressionProvider>();
            options.Providers.Add<GzipCompressionProvider>();
            options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(CompressedMimeTypes);
        });
        services.AddSingleton<IResponseCompressionProvider, EndpointAwareCompressionProvider>();
        services.Configure<BrotliCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);
        services.Configure<GzipCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);

        ForwardedHeadersSettings forwarded =
            configuration.GetSection(ForwardedHeadersSettings.SectionName).Get<ForwardedHeadersSettings>() ?? new();
        if (forwarded.Enabled)
        {
            services.Configure<ForwardedHeadersOptions>(options => ConfigureForwardedHeaders(options, forwarded));
        }

        // Singleton: the check caches its result so the public readiness endpoint cannot exhaust the DB pool.
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<DatabaseHealthCheck>();
        services.AddHealthChecks();
        services.Configure<HealthCheckServiceOptions>(options => options.Registrations.Add(new HealthCheckRegistration(
            "database",
            static sp => sp.GetRequiredService<DatabaseHealthCheck>(),
            HealthStatus.Unhealthy,
            tags: ["ready"])));

        return services;
    }

    public static WebApplication UsePolymniaPipeline(this WebApplication app)
    {
        ForwardedHeadersSettings forwarded =
            app.Configuration.GetSection(ForwardedHeadersSettings.SectionName).Get<ForwardedHeadersSettings>() ?? new();
        if (forwarded.Enabled)
        {
            app.UseForwardedHeaders();
        }
        else
        {
            app.UseMiddleware<ForwardedHeadersAdvisor>();
        }

        app.UseMiddleware<SecurityHeadersMiddleware>();

        if (app.Environment.IsDevelopment())
        {
            app.UseDeveloperExceptionPage();
        }
        else
        {
            // ProblemDetails body without stack trace or exception message.
            app.UseExceptionHandler();
            app.UseHsts();

            // Orchestrator probes reach the container over plain HTTP: never redirect the health endpoints.
            app.UseWhen(
                static context => !context.Request.Path.StartsWithSegments("/api/health", StringComparison.OrdinalIgnoreCase),
                static branch => branch.UseHttpsRedirection());
        }

        // Bodiless 4xx/5xx responses (404, 405...) become ProblemDetails.
        app.UseStatusCodePages();
        app.UseResponseCompression();
        app.UseSpaStaticFiles();

        // Explicit, and after static files: WebApplication would otherwise route first, and the SPA
        // fallback endpoint would then shadow real files (static files skip requests that matched an endpoint).
        app.UseRouting();

        return app;
    }

    public static WebApplication MapPolymniaEndpoints(this WebApplication app)
    {
        HttpMethodMetadata readOnly = new(["GET", "HEAD"]);

        // Liveness: no dependency check, so it is fast and cannot leak anything.
        app.MapHealthChecks("/api/health", new() { Predicate = static _ => false }).WithMetadata(readOnly);

        // Readiness: checks the database. The body is only "Healthy" or "Unhealthy".
        app.MapHealthChecks("/api/health/ready", new() { Predicate = static r => r.Tags.Contains("ready") })
            .WithMetadata(readOnly);

        // Unknown API routes are a 404 ProblemDetails, never the SPA.
        app.MapFallback("/api/{**path}", static (HttpContext context) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            return Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Not Found");
        });

        return app;
    }

    private static void ConfigureForwardedHeaders(ForwardedHeadersOptions options, ForwardedHeadersSettings settings)
    {
        // Host is deliberately not forwarded: use the AllowedHosts setting instead.
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardLimit = settings.ForwardLimit;

        if (settings.KnownProxies.Length == 0 && settings.KnownNetworks.Length == 0)
        {
            // Keep the framework default: only loopback proxies are trusted.
            return;
        }

        options.KnownProxies.Clear();
        options.KnownIPNetworks.Clear();
        foreach (string proxy in settings.KnownProxies)
        {
            options.KnownProxies.Add(IPAddress.Parse(proxy));
        }

        foreach (string network in settings.KnownNetworks)
        {
            options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
        }
    }
}
