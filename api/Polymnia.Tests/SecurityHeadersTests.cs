using System.Net;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Polymnia.Tests;

public sealed class SecurityHeadersTests : IDisposable
{
    private readonly TestApp _app = new();

    public void Dispose() => _app.Dispose();

    public static TheoryData<string> Paths => new()
    {
        "/api/health",
        "/api/does-not-exist",
        "/",
        "/scores/42",
        "/assets/index-4f9a1c2b.js",
        "/assets/missing.js",
    };

    [Theory]
    [MemberData(nameof(Paths))]
    public async Task Every_response_carries_the_security_headers(string path)
    {
        using HttpClient client = _app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync(path, TestContext.Current.CancellationToken);

        Assert.Equal(
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
            Single(response, "Content-Security-Policy"));
        Assert.Equal("nosniff", Single(response, "X-Content-Type-Options"));
        Assert.Equal("strict-origin-when-cross-origin", Single(response, "Referrer-Policy"));
        Assert.Equal("same-origin", Single(response, "Cross-Origin-Opener-Policy"));

        string permissions = Single(response, "Permissions-Policy");
        Assert.Contains("midi=(self)", permissions, StringComparison.Ordinal);
        Assert.Contains("camera=()", permissions, StringComparison.Ordinal);
        Assert.Contains("geolocation=()", permissions, StringComparison.Ordinal);
        Assert.Contains("microphone=()", permissions, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Hsts_is_sent_outside_development()
    {
        using HttpClient client = _app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync("/api/health", TestContext.Current.CancellationToken);

        string hsts = Single(response, "Strict-Transport-Security");
        Assert.Contains("max-age=31536000", hsts, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Plain_http_is_redirected_to_https_outside_development()
    {
        using HttpClient client = _app.CreateClient(new()
        {
            BaseAddress = new Uri("http://polymnia.example"),
            AllowAutoRedirect = false,
        });

        using HttpResponseMessage response = await client.GetAsync("/library", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.TemporaryRedirect, response.StatusCode);
        Assert.Equal("https://polymnia.example/library", response.Headers.Location?.ToString());
    }

    [Fact]
    public async Task Development_does_not_redirect_or_send_hsts()
    {
        using var dev = new TestApp(environment: "Development");
        using HttpClient client = dev.CreateClient(new()
        {
            BaseAddress = new Uri("http://polymnia.example"),
            AllowAutoRedirect = false,
        });

        using HttpResponseMessage response = await client.GetAsync("/api/health", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(response.Headers.Contains("Strict-Transport-Security"));
    }

    [Fact]
    public void Server_header_is_disabled()
    {
        KestrelServerOptions kestrel = _app.Services.GetRequiredService<IOptions<KestrelServerOptions>>().Value;

        Assert.False(kestrel.AddServerHeader);
    }

    [Fact]
    public void Request_body_size_has_a_small_default_limit()
    {
        KestrelServerOptions kestrel = _app.Services.GetRequiredService<IOptions<KestrelServerOptions>>().Value;

        Assert.Equal(1024 * 1024, kestrel.Limits.MaxRequestBodySize);
    }

    [Fact]
    public async Task Content_security_policy_can_be_overridden_by_configuration()
    {
        using var app = new TestApp(settings: new() { ["Security:ContentSecurityPolicy"] = "default-src 'none'" });
        using HttpClient client = app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync("/api/health", TestContext.Current.CancellationToken);

        Assert.Equal("default-src 'none'", Single(response, "Content-Security-Policy"));
    }

    private static string Single(HttpResponseMessage response, string name)
    {
        Assert.True(response.Headers.TryGetValues(name, out IEnumerable<string>? values), $"Missing header {name}");
        return Assert.Single(values);
    }
}
