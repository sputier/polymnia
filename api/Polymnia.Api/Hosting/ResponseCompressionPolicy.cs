using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.Extensions.Options;

namespace Polymnia.Api.Hosting;

/// <summary>
/// Marks an endpoint whose responses must never be compressed.
/// Mitigation rule (BREACH): a response that contains a secret or a token (antiforgery token, share token,
/// anything user-secret) must carry this metadata. Apply it with
/// <see cref="ResponseCompressionEndpointExtensions.DisableResponseCompression{TBuilder}(TBuilder)"/>
/// on minimal endpoints, or as an attribute on a controller or action.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false)]
public sealed class DisableResponseCompressionAttribute : Attribute;

internal static class ResponseCompressionEndpointExtensions
{
    /// <summary>Excludes the endpoint from response compression (see <see cref="DisableResponseCompressionAttribute"/>).</summary>
    public static TBuilder DisableResponseCompression<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        return builder.WithMetadata(new DisableResponseCompressionAttribute());
    }
}

/// <summary>
/// The default provider, except that endpoints carrying <see cref="DisableResponseCompressionAttribute"/>
/// are never compressed. The decision is taken when the response starts, so the matched endpoint is known.
/// </summary>
internal sealed class EndpointAwareCompressionProvider(IServiceProvider services, IOptions<ResponseCompressionOptions> options)
    : IResponseCompressionProvider
{
    private readonly ResponseCompressionProvider _inner = new(services, options);

    public ICompressionProvider? GetCompressionProvider(HttpContext context) => _inner.GetCompressionProvider(context);

    public bool CheckRequestAcceptsCompression(HttpContext context) => _inner.CheckRequestAcceptsCompression(context);

    public bool ShouldCompressResponse(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        return context.GetEndpoint()?.Metadata.GetMetadata<DisableResponseCompressionAttribute>() is null
            && _inner.ShouldCompressResponse(context);
    }
}
