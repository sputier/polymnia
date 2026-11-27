using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Polymnia.Api.Legal;

namespace Polymnia.Tests;

/// <summary><c>GET /api/legal</c> and the fail-fast rule of the <c>Legal</c> settings (docs/privacy.md). No database.</summary>
public sealed class LegalTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Legal_is_public_cacheable_and_shows_the_configured_operator()
    {
        using var app = new TestApp(settings: new()
        {
            ["Legal:Address"] = "1 Example Street, Example City",
            ["Legal:HostingCountry"] = "Exampleland",
            ["Legal:LogRetentionDays"] = "14",
        });
        var browser = new TestBrowser(app);

        using HttpResponseMessage response = await browser.GetAsync("/api/legal");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("max-age=300", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        Assert.Contains("public", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        JsonElement legal = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.True(legal.GetProperty("configured").GetBoolean());
        Assert.Equal("Example Operator", legal.GetProperty("operatorName").GetString());
        Assert.Equal("privacy@polymnia.example", legal.GetProperty("contact").GetString());
        Assert.Equal("email", legal.GetProperty("contactKind").GetString());
        Assert.Equal("Example Hosting", legal.GetProperty("hostingProvider").GetString());
        Assert.Equal("Exampleland", legal.GetProperty("hostingCountry").GetString());
        Assert.Equal("1 Example Street, Example City", legal.GetProperty("address").GetString());
        Assert.Equal(14, legal.GetProperty("logRetentionDays").GetInt32());
        Assert.Equal(7, legal.GetProperty("sessionIdleDays").GetInt32());
        Assert.Equal(30, legal.GetProperty("sessionAbsoluteDays").GetInt32());
    }

    [Fact]
    public async Task Legal_in_development_without_settings_is_reported_as_not_configured()
    {
        using var app = new TestApp(environment: "Development", configureAuth: false);
        var browser = new TestBrowser(app);

        using HttpResponseMessage response = await browser.GetAsync("/api/legal");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        JsonElement legal = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.False(legal.GetProperty("configured").GetBoolean());
        Assert.Equal(JsonValueKind.Null, legal.GetProperty("operatorName").ValueKind);
        Assert.Equal(JsonValueKind.Null, legal.GetProperty("contact").ValueKind);
    }

    [Fact]
    public void Production_refuses_to_start_without_the_legal_settings()
    {
        using var app = new TestApp(settings: new()
        {
            ["Legal:OperatorName"] = "",
            ["Legal:Contact"] = "",
            ["Legal:HostingProvider"] = "",
        });

        Exception ex = Assert.ThrowsAny<Exception>(() => app.CreateClient());

        string message = ex.ToString();
        Assert.Contains("Legal:OperatorName", message, StringComparison.Ordinal);
        Assert.Contains("Legal:Contact", message, StringComparison.Ordinal);
        Assert.Contains("Legal:HostingProvider", message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("http://not-https.example")]
    [InlineData("two words@example.com")]
    [InlineData("<script>@example.com")]
    public void A_contact_that_is_neither_an_email_nor_an_https_url_is_refused_without_echoing_it(string contact)
    {
        using var app = new TestApp(settings: new() { ["Legal:Contact"] = contact });

        Exception ex = Assert.ThrowsAny<Exception>(() => app.CreateClient());

        Assert.Contains("Legal:Contact", ex.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain(contact, ex.ToString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("privacy@example.com", "email")]
    [InlineData("https://example.com/contact", "url")]
    [InlineData("http://example.com", null)]
    [InlineData("mailto:a@example.com", null)]
    [InlineData("a@b", null)]
    [InlineData("a@@example.com", null)]
    [InlineData("https://user:pw@example.com", null)]
    public void Contact_kind_is_strict(string value, string? kind)
    {
        Assert.Equal(kind, LegalOptionsValidator.ContactKind(value));
    }
}
