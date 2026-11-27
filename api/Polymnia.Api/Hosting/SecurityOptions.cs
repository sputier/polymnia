namespace Polymnia.Api.Hosting;

/// <summary>Binds the <c>Security</c> configuration section.</summary>
internal sealed class SecurityOptions
{
    public const string SectionName = "Security";

    /// <summary>Baseline policy: same-origin only, no inline script or style, no plugins, no framing.</summary>
    public const string DefaultContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://*.googleusercontent.com; font-src 'self'; " +
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

    /// <summary>
    /// Content-Security-Policy value. Override only through configuration and document why
    /// (see docs/development.md, "Content Security Policy").
    /// </summary>
    public string ContentSecurityPolicy { get; set; } = DefaultContentSecurityPolicy;
}
