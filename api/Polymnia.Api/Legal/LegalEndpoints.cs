using Microsoft.Extensions.Options;
using Polymnia.Api.Auth;

namespace Polymnia.Api.Legal;

/// <summary>What <c>GET /api/legal</c> returns: the operator's settings and the retention periods the page quotes.</summary>
internal sealed record LegalResponse(
    bool Configured,
    string? OperatorName,
    string? Contact,
    string? ContactKind,
    string? Address,
    string? HostingProvider,
    string? HostingCountry,
    int LogRetentionDays,
    int SessionIdleDays,
    int SessionAbsoluteDays);

internal static class LegalEndpoints
{
    public static IServiceCollection AddLegal(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.AddOptions<LegalOptions>().Bind(configuration.GetSection(LegalOptions.SectionName)).ValidateOnStart();
        services.AddSingleton<IValidateOptions<LegalOptions>, LegalOptionsValidator>();
        return services;
    }

    public static IEndpointRouteBuilder MapLegalEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // Public (the privacy page is read signed out) and identical for everyone: built once, cacheable.
        Lazy<LegalResponse>? cached = null;
        endpoints.MapGet("/api/legal", (HttpContext context, IOptions<LegalOptions> legal, IOptions<AuthOptions> auth) =>
        {
            cached ??= new Lazy<LegalResponse>(() => Build(legal.Value, auth.Value));
            context.Response.Headers.CacheControl = "public, max-age=300";
            return Results.Ok(cached.Value);
        })
        .WithMetadata(new HttpMethodMetadata(["GET", "HEAD"]));

        return endpoints;
    }

    internal static LegalResponse Build(LegalOptions legal, AuthOptions auth)
    {
        string? operatorName = Clean(legal.OperatorName);
        string? contact = Clean(legal.Contact);
        string? kind = contact is null ? null : LegalOptionsValidator.ContactKind(contact);
        string? hosting = Clean(legal.HostingProvider);
        return new LegalResponse(
            Configured: operatorName is not null && kind is not null && hosting is not null,
            operatorName,
            kind is null ? null : contact,
            kind,
            Clean(legal.Address),
            hosting,
            Clean(legal.HostingCountry),
            legal.LogRetentionDays,
            (int)Math.Ceiling(auth.IdleTimeout.TotalDays),
            (int)Math.Ceiling(auth.AbsoluteTimeout.TotalDays));
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
