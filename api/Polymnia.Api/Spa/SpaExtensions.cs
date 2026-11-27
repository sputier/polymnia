using Microsoft.Extensions.FileProviders;
using Microsoft.Net.Http.Headers;

namespace Polymnia.Api.Spa;

/// <summary>Serves the built front end from <c>wwwroot</c> with a history-API fallback.</summary>
internal static class SpaExtensions
{
    private const string IndexFile = "index.html";
    private const string HashedAssetsPrefix = "/assets";

    private const string ImmutableCache = "public, max-age=31536000, immutable";
    private const string RevalidateCache = "no-cache";

    /// <summary>
    /// Static files. Everything under <c>/assets</c> (Vite output, content-hashed file names) is immutable;
    /// anything else, including <c>index.html</c>, must be revalidated on each use.
    /// </summary>
    public static IApplicationBuilder UseSpaStaticFiles(this IApplicationBuilder app)
    {
        return app.UseStaticFiles(new StaticFileOptions
        {
            OnPrepareResponse = static context =>
            {
                bool hashed = context.Context.Request.Path.StartsWithSegments(HashedAssetsPrefix, StringComparison.Ordinal);
                context.Context.Response.Headers.CacheControl = hashed ? ImmutableCache : RevalidateCache;
            },
        });
    }

    /// <summary>
    /// Any GET/HEAD that matched nothing else and is not an API route or a file request
    /// (no extension) receives <c>index.html</c>, so client-side routes survive a reload.
    /// </summary>
    public static IEndpointRouteBuilder MapSpaFallback(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapFallback("{*path}", ServeIndex)
            .WithMetadata(new HttpMethodMetadata(["GET", "HEAD"]));
        return endpoints;
    }

    private static IResult ServeIndex(HttpContext context)
    {
        string? path = context.Request.Path.Value;
        IFileInfo file = context.RequestServices.GetRequiredService<IWebHostEnvironment>().WebRootFileProvider.GetFileInfo(IndexFile);

        // A missing file (/assets/missing.js) must stay a 404, and the API never falls back to the SPA.
        // Client-side route segments must therefore not contain a dot (documented in docs/development.md).
        if (!file.Exists || Path.HasExtension(path) || context.Request.Path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase))
        {
            return Results.StatusCode(StatusCodes.Status404NotFound);
        }

        context.Response.Headers.CacheControl = RevalidateCache;

        // ETag + Last-Modified so that revalidation of a deep link answers 304 instead of resending the page.
        DateTimeOffset lastModified = file.LastModified.ToUniversalTime();
        var etag = new EntityTagHeaderValue($"\"{lastModified.UtcTicks:x}-{file.Length:x}\"");
        return Results.File(file.CreateReadStream(), "text/html; charset=utf-8", lastModified: lastModified, entityTag: etag);
    }
}
