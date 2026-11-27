using System.Net;
using Microsoft.Extensions.Configuration;
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
        var validator = new AuthOptionsValidator(new FakeEnvironment(environment), Deployment("polymnia.example", TestCertificate.Path));

        Assert.Equal(valid, validator.Validate(null, options).Succeeded);
    }

    [Fact]
    public void Options_validation_failures_never_contain_the_secret()
    {
        var options = new AuthOptions { PublicBaseUrl = "http://x.example", Google = { ClientId = "id", ClientSecret = "very-secret-value" } };
        var validator = new AuthOptionsValidator(new FakeEnvironment("Production"), Deployment("polymnia.example", TestCertificate.Path));

        ValidateOptionsResult result = validator.Validate(null, options);

        Assert.True(result.Failed);
        Assert.DoesNotContain("very-secret-value", string.Join(' ', result.Failures!), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData("*", true)]
    [InlineData("polymnia.example;*", true)]
    [InlineData("polymnia.example", false)]
    [InlineData("polymnia.example;www.polymnia.example", false)]
    [InlineData("*.polymnia.example", false)]
    public void Outside_development_AllowedHosts_must_list_real_hosts(string? allowedHosts, bool fails)
    {
        var options = new AuthOptions { PublicBaseUrl = "https://polymnia.example", Google = { ClientId = "id", ClientSecret = "secret" } };
        var validator = new AuthOptionsValidator(new FakeEnvironment("Production"), Deployment(allowedHosts, TestCertificate.Path));

        ValidateOptionsResult result = validator.Validate(null, options);

        Assert.Equal(fails, result.Failed);
        if (fails)
        {
            Assert.Contains("AllowedHosts", string.Join(' ', result.Failures!), StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Development_accepts_wildcard_hosts_and_no_certificate()
    {
        var options = new AuthOptions();
        var validator = new AuthOptionsValidator(new FakeEnvironment("Development"), Deployment("*", null));

        Assert.True(validator.Validate(null, options).Succeeded);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("/nonexistent/dp.pfx")]
    public void Outside_development_the_data_protection_certificate_is_mandatory(string? path)
    {
        var options = new AuthOptions { PublicBaseUrl = "https://polymnia.example", Google = { ClientId = "id", ClientSecret = "secret" } };
        var validator = new AuthOptionsValidator(new FakeEnvironment("Production"), Deployment("polymnia.example", path));

        ValidateOptionsResult result = validator.Validate(null, options);

        Assert.True(result.Failed);
        Assert.Contains("DataProtection:CertificatePath", string.Join(' ', result.Failures!), StringComparison.Ordinal);
    }

    [Fact]
    public void Production_host_refuses_to_start_without_a_certificate_or_with_wildcard_hosts()
    {
        using var app = new TestApp(
            environment: "Production",
            settings: new() { ["DataProtection:CertificatePath"] = string.Empty, ["AllowedHosts"] = "*" });

        Exception ex = Assert.ThrowsAny<Exception>(() => app.CreateClient());

        string message = ex.ToString();
        Assert.Contains("DataProtection:CertificatePath", message, StringComparison.Ordinal);
        Assert.Contains("AllowedHosts", message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Auth_endpoints_are_rate_limited_per_ip_with_retry_after_and_other_routes_are_not()
    {
        using var app = new TestApp(settings: new() { ["Auth:RateLimit:PermitLimit"] = "3", ["Auth:RateLimit:Window"] = "00:01:00" });
        var browser = new TestBrowser(app);

        var statuses = new List<HttpStatusCode>();
        HttpResponseMessage? limited = null;
        for (int i = 0; i < 5; i++)
        {
            HttpResponseMessage response = await browser.GetAsync("/api/auth/login");
            statuses.Add(response.StatusCode);
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                limited ??= response;
            }
            else
            {
                response.Dispose();
            }
        }

        Assert.Equal([HttpStatusCode.Redirect, HttpStatusCode.Redirect, HttpStatusCode.Redirect, HttpStatusCode.TooManyRequests, HttpStatusCode.TooManyRequests], statuses);
        Assert.NotNull(limited);
        Assert.True(int.Parse(limited.Headers.GetValues("Retry-After").Single(), System.Globalization.CultureInfo.InvariantCulture) is > 0 and <= 60);
        limited.Dispose();

        using HttpResponseMessage health = await browser.GetAsync("/api/health");
        using HttpResponseMessage me = await browser.GetAsync("/api/me");
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
    }

    [Fact]
    public async Task The_rate_limit_is_per_client_and_the_callback_redirects_instead_of_showing_an_error()
    {
        using var app = new TestApp(settings: new() { ["Auth:RateLimit:PermitLimit"] = "1" });
        var browser = new TestBrowser(app);

        using HttpResponseMessage first = await browser.SendAsync(HttpMethod.Get, "/api/auth/login", clientIp: "203.0.113.1");
        using HttpResponseMessage secondSameClient = await browser.SendAsync(HttpMethod.Get, "/api/auth/login", clientIp: "203.0.113.1");
        using HttpResponseMessage otherClient = await browser.SendAsync(HttpMethod.Get, "/api/auth/login", clientIp: "203.0.113.2");
        using HttpResponseMessage callback = await browser.SendAsync(HttpMethod.Get, "/api/auth/callback?code=x", clientIp: "203.0.113.1");

        Assert.Equal(HttpStatusCode.Redirect, first.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, secondSameClient.StatusCode);
        Assert.Equal(HttpStatusCode.Redirect, otherClient.StatusCode);
        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal("/?signin=failed", callback.Headers.Location!.OriginalString);
    }

    [Theory]
    [InlineData("203.0.113.7", "203.0.113.7")]
    [InlineData("::ffff:203.0.113.7", "203.0.113.7")]
    [InlineData("2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64")]
    [InlineData("2001:db8:1:2:1111:2222:3333:4444", "2001:db8:1:2::/64")]
    public void Rate_limit_key_is_the_ipv4_address_or_the_ipv6_slash_64(string address, string expected) =>
        Assert.Equal(expected, AuthExtensions.ClientKey(System.Net.IPAddress.Parse(address)));

    [Fact]
    public void Without_a_client_address_there_is_no_rate_limit_key() =>
        Assert.Null(AuthExtensions.ClientKey(null));

    [Theory]
    [InlineData("[*]")]
    [InlineData("*:443")]
    [InlineData("polymnia.example;*:8080")]
    public void Wildcard_hosts_with_ports_are_refused_too(string allowedHosts)
    {
        var options = new AuthOptions { PublicBaseUrl = "https://polymnia.example", Google = { ClientId = "id", ClientSecret = "secret" } };
        var validator = new AuthOptionsValidator(new FakeEnvironment("Production"), Deployment(allowedHosts, TestCertificate.Path));

        Assert.True(validator.Validate(null, options).Failed);
    }

    [Fact]
    public void The_certificate_password_can_come_from_a_file_which_wins_over_the_variable()
    {
        string file = Path.Combine(Path.GetTempPath(), "polymnia-pw-" + Guid.NewGuid().ToString("N"));
        File.WriteAllText(file, "from-file\n");
        try
        {
            IConfiguration both = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["DataProtection:CertificatePassword"] = "from-variable",
                ["DataProtection:CertificatePasswordFile"] = file,
            }).Build();
            IConfiguration variableOnly = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["DataProtection:CertificatePassword"] = "from-variable",
            }).Build();

            Assert.Equal("from-file", AuthExtensions.ReadCertificatePassword(both)); // trailing newline is not part of it
            Assert.Equal("from-variable", AuthExtensions.ReadCertificatePassword(variableOnly));
        }
        finally
        {
            File.Delete(file);
        }
    }

    [Fact]
    public void The_host_starts_with_the_certificate_password_read_from_a_file_and_stops_when_it_is_wrong()
    {
        string good = Path.Combine(Path.GetTempPath(), "polymnia-pw-" + Guid.NewGuid().ToString("N"));
        string bad = Path.Combine(Path.GetTempPath(), "polymnia-pw-" + Guid.NewGuid().ToString("N"));
        File.WriteAllText(good, TestCertificate.Password + "\n");
        File.WriteAllText(bad, "wrong-password");
        try
        {
            using (var ok = new TestApp(settings: new() { ["DataProtection:CertificatePassword"] = string.Empty, ["DataProtection:CertificatePasswordFile"] = good }))
            {
                using HttpClient client = ok.CreateClient();
            }

            using var wrong = new TestApp(settings: new() { ["DataProtection:CertificatePasswordFile"] = bad });
            Exception ex = Assert.ThrowsAny<Exception>(() => wrong.CreateClient());
            Assert.DoesNotContain("wrong-password", ex.ToString(), StringComparison.Ordinal);
        }
        finally
        {
            File.Delete(good);
            File.Delete(bad);
        }
    }

    [Fact]
    public void A_missing_certificate_password_file_stops_the_host()
    {
        using var app = new TestApp(settings: new() { ["DataProtection:CertificatePasswordFile"] = "/nonexistent/password" });

        Exception ex = Assert.ThrowsAny<Exception>(() => app.CreateClient());

        Assert.Contains("CertificatePasswordFile", ex.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void A_certificate_without_a_private_key_stops_the_host()
    {
        using var app = new TestApp(
            environment: "Production",
            settings: new() { ["DataProtection:CertificatePath"] = TestCertificate.CreatePublicOnly() });

        Exception ex = Assert.ThrowsAny<Exception>(() => app.CreateClient());

        Assert.Contains("private key", ex.ToString(), StringComparison.Ordinal);
    }

    internal static Microsoft.Extensions.Configuration.IConfiguration Deployment(string? allowedHosts, string? certificatePath) =>
        new Microsoft.Extensions.Configuration.ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AllowedHosts"] = allowedHosts,
                ["DataProtection:CertificatePath"] = certificatePath,
            })
            .Build();

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
