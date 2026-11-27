using System.Net;
using Microsoft.Extensions.Options;
using Polymnia.Api.Auth;
using Polymnia.Infrastructure.Users;

namespace Polymnia.Tests;

/// <summary>Authentication behaviour that needs no database (no session is ever read or written).</summary>
public sealed class AuthWithoutDatabaseTests
{
    [Fact]
    public async Task Anonymous_me_is_401_without_redirect_and_not_cacheable()
    {
        using var app = new TestApp();
        var browser = new TestBrowser(app);

        using HttpResponseMessage response = await browser.GetAsync("/api/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Null(response.Headers.Location);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("POST", "/api/auth/logout")]
    [InlineData("POST", "/api/anything")]
    [InlineData("PUT", "/api/anything")]
    [InlineData("PATCH", "/api/anything")]
    [InlineData("DELETE", "/api/anything")]
    public async Task Unsafe_request_without_antiforgery_header_is_400(string method, string path)
    {
        using var app = new TestApp();
        var browser = new TestBrowser(app);

        using HttpResponseMessage response = await browser.SendAsync(new HttpMethod(method), path);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("\"code\":\"antiforgery\"", await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Unsafe_request_with_a_header_but_no_antiforgery_cookie_is_400()
    {
        using var app = new TestApp();
        var browser = new TestBrowser(app);

        using HttpResponseMessage response = await browser.SendAsync(HttpMethod.Post, "/api/auth/logout", xsrfHeader: "forged");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Login_is_503_when_google_is_not_configured_in_development()
    {
        using var app = new TestApp(environment: "Development", configureAuth: false);
        var browser = new TestBrowser(app);

        using HttpResponseMessage login = await browser.GetAsync("/api/auth/login");
        using HttpResponseMessage me = await browser.GetAsync("/api/me");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, login.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
    }

    [Fact]
    public void Production_refuses_to_start_without_google_client_id_and_secret()
    {
        using var app = new TestApp(environment: "Production", configureAuth: false);

        Exception ex = Assert.ThrowsAny<Exception>(() => app.CreateClient());

        string message = ex.ToString();
        Assert.Contains("Auth:Google:ClientId", message, StringComparison.Ordinal);
        Assert.Contains("Auth:Google:ClientSecret", message, StringComparison.Ordinal);
    }

    [Fact]
    public void Production_refuses_to_start_with_a_non_https_public_base_url()
    {
        using var app = new TestApp(
            environment: "Production",
            settings: new() { ["Auth:PublicBaseUrl"] = "http://polymnia.example" });

        Exception ex = Assert.ThrowsAny<Exception>(() => app.CreateClient());

        Assert.Contains("Auth:PublicBaseUrl", ex.ToString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null, "/")]
    [InlineData("", "/")]
    [InlineData("/", "/")]
    [InlineData("/scores/42?tab=notes#x", "/scores/42?tab=notes#x")]
    [InlineData("https://evil.example", "/")]
    [InlineData("//evil.example", "/")]
    [InlineData("/\\evil.example", "/")]
    [InlineData("\\\\evil.example", "/")]
    [InlineData("javascript:alert(1)", "/")]
    [InlineData("evil.example", "/")]
    [InlineData("/ok\r\nSet-Cookie: x=1", "/")]
    [InlineData("/api/auth/login", "/")]
    public void Return_url_is_local_only(string? input, string expected) =>
        Assert.Equal(expected, ReturnUrl.Sanitize(input));

    [Fact]
    public void Return_url_longer_than_2048_characters_is_rejected() =>
        Assert.Equal("/", ReturnUrl.Sanitize("/" + new string('a', 2048)));

    [Theory]
    [InlineData("https://lh3.googleusercontent.com/a/abc", "https://lh3.googleusercontent.com/a/abc")]
    [InlineData("http://lh3.googleusercontent.com/a/abc", null)]
    [InlineData("https://evil.example/a.png", null)]
    [InlineData("https://googleusercontent.com.evil.example/a.png", null)]
    [InlineData("https://user:pw@lh3.googleusercontent.com/a", null)]
    [InlineData("not a url", null)]
    [InlineData(null, null)]
    public void Avatar_url_must_be_https_on_a_google_user_content_host(string? input, string? expected) =>
        Assert.Equal(expected, UserProvisioner.SanitizeAvatarUrl(input));

    [Theory]
    [InlineData("Production", "https://polymnia.example", "id", "secret", true)]
    [InlineData("Production", "https://polymnia.example", null, "secret", false)]
    [InlineData("Production", "https://polymnia.example/app", "id", "secret", false)]
    [InlineData("Production", null, "id", "secret", false)]
    [InlineData("Development", "http://localhost:5173", "id", "secret", true)]
    [InlineData("Development", "http://localhost:5173", null, null, true)]
    [InlineData("Development", "http://polymnia.example", "id", "secret", false)]
    [InlineData("Development", "http://localhost:5173", "id", null, false)]
    public void Options_validation(string environment, string? baseUrl, string? id, string? secret, bool valid)
    {
        var options = new AuthOptions { PublicBaseUrl = baseUrl, Google = { ClientId = id, ClientSecret = secret } };
        var validator = new AuthOptionsValidator(new FakeEnvironment(environment));

        Assert.Equal(valid, validator.Validate(null, options).Succeeded);
    }

    [Fact]
    public void Options_validation_failures_never_contain_the_secret()
    {
        var options = new AuthOptions { PublicBaseUrl = "http://x.example", Google = { ClientId = "id", ClientSecret = "very-secret-value" } };
        var validator = new AuthOptionsValidator(new FakeEnvironment("Production"));

        ValidateOptionsResult result = validator.Validate(null, options);

        Assert.True(result.Failed);
        Assert.DoesNotContain("very-secret-value", string.Join(' ', result.Failures!), StringComparison.Ordinal);
    }

    internal static void AssertCookieFlags(string setCookie, string sameSite, bool httpOnly)
    {
        string lower = setCookie.ToLowerInvariant();
        Assert.Contains("; secure", lower, StringComparison.Ordinal);
        Assert.Contains("; path=/", lower, StringComparison.Ordinal);
        Assert.Contains($"; samesite={sameSite}", lower, StringComparison.Ordinal);
        Assert.DoesNotContain("; domain=", lower, StringComparison.Ordinal);
        Assert.Equal(httpOnly, lower.Contains("; httponly", StringComparison.Ordinal));
    }

    private sealed class FakeEnvironment(string name) : Microsoft.Extensions.Hosting.IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;

        public string ApplicationName { get; set; } = "Polymnia";

        public string ContentRootPath { get; set; } = string.Empty;

        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
            new Microsoft.Extensions.FileProviders.NullFileProvider();
    }
}
