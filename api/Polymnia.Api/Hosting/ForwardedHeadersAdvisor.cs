namespace Polymnia.Api.Hosting;

/// <summary>
/// Used only when forwarded headers are disabled. The first request that carries <c>X-Forwarded-For</c> or
/// <c>Forwarded</c> shows the app sits behind a reverse proxy that is not trusted: every client then has the proxy's
/// address, so the per-address rate limits (sign-in, public share links) are one shared budget. A single warning per
/// process says so. The headers are never read or trusted here.
/// </summary>
internal sealed partial class ForwardedHeadersAdvisor(RequestDelegate next, ILoggerFactory loggers)
{
    public const string Category = "Polymnia.Hosting";

    private readonly ILogger _logger = loggers.CreateLogger(Category);
    private int _warned;

    public Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (_warned == 0
            && (context.Request.Headers.ContainsKey("X-Forwarded-For") || context.Request.Headers.ContainsKey("Forwarded"))
            && Interlocked.Exchange(ref _warned, 1) == 0)
        {
            ProxyNotTrusted(_logger);
        }

        return next(context);
    }

    [LoggerMessage(
        EventId = 30,
        EventName = "ForwardedHeadersDisabled",
        Level = LogLevel.Warning,
        Message = "A request carried X-Forwarded-For or Forwarded but forwarded headers are disabled: behind a reverse proxy every client shares the proxy's address, so the per-address rate limits (sign-in, share links) are one shared budget. Set POLYMNIA_FORWARDED_HEADERS=true (ForwardedHeaders:Enabled) and trust the proxy (see docs/self-hosting.md). Logged once.")]
    private static partial void ProxyNotTrusted(ILogger logger);
}
