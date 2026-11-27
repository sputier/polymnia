using Microsoft.Extensions.Logging;

namespace Polymnia.Tests;

public sealed class ForwardedHeadersAdvisorTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static async Task GetAsync(HttpClient client, string? header, string value)
    {
        using HttpRequestMessage request = new(HttpMethod.Get, "/api/health");
        if (header is not null)
        {
            request.Headers.TryAddWithoutValidation(header, value);
        }

        using HttpResponseMessage response = await client.SendAsync(request, Ct);
        Assert.True(response.IsSuccessStatusCode);
    }

    private static int Warnings(TestApp app) =>
        app.Logs.Entries.Count(e => e.EventId.Name == "ForwardedHeadersDisabled" && e.Level == LogLevel.Warning);

    [Theory]
    [InlineData("X-Forwarded-For", "203.0.113.9")]
    [InlineData("Forwarded", "for=203.0.113.9")]
    public async Task A_proxy_header_with_forwarded_headers_disabled_warns_once_per_process(string header, string value)
    {
        using var app = new TestApp();
        using HttpClient client = app.CreateSecureClient();

        await GetAsync(client, null, "");
        Assert.Equal(0, Warnings(app));

        await GetAsync(client, header, value);
        await GetAsync(client, header, value);
        await GetAsync(client, "X-Forwarded-For", "198.51.100.1");

        Assert.Equal(1, Warnings(app));
        string message = app.Logs.Entries.Single(e => e.EventId.Name == "ForwardedHeadersDisabled").Message;
        Assert.Contains("POLYMNIA_FORWARDED_HEADERS", message, StringComparison.Ordinal);
        Assert.Contains("rate limits", message, StringComparison.Ordinal);
        // The header value is never logged.
        Assert.DoesNotContain("203.0.113.9", message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task No_warning_when_forwarded_headers_are_enabled()
    {
        using var app = new TestApp(settings: new() { ["ForwardedHeaders:Enabled"] = "true" });
        using HttpClient client = app.CreateSecureClient();

        await GetAsync(client, "X-Forwarded-For", "203.0.113.9");

        Assert.Equal(0, Warnings(app));
    }
}
