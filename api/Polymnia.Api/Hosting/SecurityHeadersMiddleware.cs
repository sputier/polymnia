using Microsoft.Extensions.Options;

namespace Polymnia.Api.Hosting;

/// <summary>
/// Adds the security response headers to every response, including errors and redirects.
/// Headers are written in <c>OnStarting</c> so that they survive the exception handler,
/// which clears the response.
/// </summary>
internal sealed class SecurityHeadersMiddleware(RequestDelegate next, IOptions<SecurityOptions> options)
{
    private const string PermissionsPolicy =
        "accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), " +
        "magnetometer=(), microphone=(), midi=(self), payment=(), usb=()";

    private readonly string _contentSecurityPolicy = options.Value.ContentSecurityPolicy;

    public Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(
            static state =>
            {
                var (self, ctx) = ((SecurityHeadersMiddleware, HttpContext))state;
                IHeaderDictionary headers = ctx.Response.Headers;
                headers.ContentSecurityPolicy = self._contentSecurityPolicy;
                headers.XContentTypeOptions = "nosniff";
                // The public share endpoint takes a credential (X-Share-Token header): nothing about it may ever be sent along.
                headers["Referrer-Policy"] = ctx.Request.Path.StartsWithSegments(Polymnia.Api.Sharing.ShareEndpoints.SharedPath, StringComparison.OrdinalIgnoreCase)
                    ? "no-referrer"
                    : "strict-origin-when-cross-origin";
                headers["Permissions-Policy"] = PermissionsPolicy;
                headers["Cross-Origin-Opener-Policy"] = "same-origin";

                // Every answer of the public share endpoint (200, 404, 429, fallback) is kept out of indexes.
                if (ctx.Request.Path.StartsWithSegments(Polymnia.Api.Sharing.ShareEndpoints.SharedPath, StringComparison.OrdinalIgnoreCase))
                {
                    headers["X-Robots-Tag"] = "noindex, nofollow, noarchive";
                }

                // API responses are never cacheable unless an endpoint says otherwise.
                if (ctx.Request.Path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase))
                {
                    headers.TryAdd("Cache-Control", "no-store");
                }

                return Task.CompletedTask;
            },
            (this, context));

        return next(context);
    }
}
