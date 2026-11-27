namespace Polymnia.Api.Scores;

/// <summary>
/// Endpoint metadata: the route reads its body through <see cref="BoundedBody"/>, which caps the DECOMPRESSED size,
/// so a gzip or Brotli request body may be inflated for it. Every other route refuses a request body that carries a
/// <c>Content-Encoding</c> (415): the request decompression middleware inflates without any limit of its own, and
/// a few kilobytes of gzip would otherwise become hundreds of megabytes in a model binder.
/// </summary>
internal sealed class AcceptsCompressedBodyMetadata;

internal static class CompressedBodyPolicy
{
    /// <summary>Marks a route as reading its body through <see cref="BoundedBody"/> (see <see cref="AcceptsCompressedBodyMetadata"/>).</summary>
    public static TBuilder AcceptsCompressedBody<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        return builder.WithMetadata(new AcceptsCompressedBodyMetadata());
    }

    /// <summary>Runs before the request decompression middleware, once the endpoint is known.</summary>
    public static IApplicationBuilder UseCompressedBodyPolicy(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.Use(static async (context, next) =>
        {
            if (context.Request.Headers.ContentEncoding.Any(static v => !string.IsNullOrWhiteSpace(v) && !v.Trim().Equals("identity", StringComparison.OrdinalIgnoreCase))
                && context.GetEndpoint()?.Metadata.GetMetadata<AcceptsCompressedBodyMetadata>() is null)
            {
                await Results.Problem(
                    statusCode: StatusCodes.Status415UnsupportedMediaType,
                    title: "Unsupported content encoding",
                    detail: "This request does not accept a compressed body.").ExecuteAsync(context);
                return;
            }

            await next(context);
        });
    }
}
