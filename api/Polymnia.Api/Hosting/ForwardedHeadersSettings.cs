namespace Polymnia.Api.Hosting;

/// <summary>
/// Binds the <c>ForwardedHeaders</c> configuration section. Disabled by default: trusting
/// <c>X-Forwarded-*</c> from an unknown sender lets clients spoof their address and scheme.
/// </summary>
internal sealed class ForwardedHeadersSettings
{
    public const string SectionName = "ForwardedHeaders";

    public bool Enabled { get; set; }

    /// <summary>Trusted proxy IP addresses, e.g. <c>10.0.0.5</c>.</summary>
    public string[] KnownProxies { get; set; } = [];

    /// <summary>Trusted proxy networks in CIDR notation, e.g. <c>172.18.0.0/16</c>.</summary>
    public string[] KnownNetworks { get; set; } = [];

    /// <summary>Maximum number of proxies in the chain that are processed.</summary>
    public int ForwardLimit { get; set; } = 1;
}
