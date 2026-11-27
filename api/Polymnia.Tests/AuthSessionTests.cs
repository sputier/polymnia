using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Polymnia.Api.Auth;
using Polymnia.Core.Users;
using Polymnia.Infrastructure;

namespace Polymnia.Tests;

/// <summary>Sign-in, session and antiforgery against a real PostgreSQL (Testcontainers). Google is faked.</summary>
public sealed class AuthSessionTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private async Task<TestApp> StartAsync()
    {
        postgres.SkipIfUnavailable();
        var app = new TestApp(connectionString: postgres.ConnectionString);
        app.Google.Subject = "sub-" + Guid.NewGuid().ToString("N");
        await app.MigrateAsync();
        return app;
    }

    private static async Task<T> WithDbAsync<T>(TestApp app, Func<PolymniaDbContext, Task<T>> action)
    {
        using IServiceScope scope = app.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<PolymniaDbContext>());
    }

    // The container is shared by the tests of this class: always scope to this test's Google subject.
    private static IQueryable<Polymnia.Infrastructure.Sessions.UserSession> SessionsOf(PolymniaDbContext db, string subject) =>
        db.Sessions.Where(s => db.Users.Any(u => u.GoogleSubject == subject && u.Id == s.UserId));

    private static Task<int> SessionCountAsync(TestApp app)
    {
        string subject = app.Google.Subject;
        return WithDbAsync(app, db => SessionsOf(db, subject).CountAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Login_redirect_uri_comes_from_configuration_not_from_the_host_header()
    {
        postgres.SkipIfUnavailable();
        using var app = new TestApp(connectionString: postgres.ConnectionString, fakeGoogle: false);
        await app.MigrateAsync();
        var browser = new TestBrowser(app);

        using HttpResponseMessage response = await browser.SendAsync(HttpMethod.Get, "/api/auth/login?returnUrl=/scores", host: "localhost");

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Uri location = response.Headers.Location!;
        Assert.Equal("accounts.example", location.Host);
        var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(location.Query);
        Assert.Equal($"{TestApp.PublicBaseUrl}/api/auth/callback", query["redirect_uri"]);
        Assert.Equal("code", query["response_type"]);
        Assert.Equal("S256", query["code_challenge_method"]);
        Assert.False(string.IsNullOrEmpty(query["code_challenge"]));
        Assert.False(string.IsNullOrEmpty(query["state"]));
        Assert.False(string.IsNullOrEmpty(query["nonce"]));
        Assert.Equal("openid profile", query["scope"]);
        Assert.DoesNotContain("localhost", location.OriginalString, StringComparison.Ordinal);

        // Correlation and nonce cookies: __Host-, Secure, HttpOnly, Lax, Path=/, no Domain.
        string[] cookies = response.Headers.GetValues("Set-Cookie").ToArray();
        Assert.Equal(2, cookies.Length);
        foreach (string cookie in cookies)
        {
            Assert.StartsWith("__Host-Polymnia.", cookie, StringComparison.Ordinal);
            AuthWithoutDatabaseTests.AssertCookieFlags(cookie, sameSite: "lax", httpOnly: true);
        }
    }

    [Fact]
    public async Task An_authenticated_request_costs_at_most_two_database_commands()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        using (await browser.SignInAsync())
        {
        }

        using (await browser.GetAsync("/api/me"))
        {
        } // warm-up: Data Protection key ring

        app.Logs.Clear();
        using HttpResponseMessage me = await browser.GetAsync("/api/me");

        int commands = app.Logs.Entries.Count(e =>
            e.Category == "Microsoft.EntityFrameworkCore.Database.Command" && e.EventId.Id == 20101);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        Console.WriteLine($"DB commands for an authenticated GET /api/me: {commands}");
        Assert.InRange(commands, 1, 2);
    }

    [Fact]
    public async Task Signed_in_me_returns_the_profile_and_nothing_else()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);

        using HttpResponseMessage callback = await browser.SignInAsync("/scores");
        using HttpResponseMessage me = await browser.GetAsync("/api/me");

        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal("/scores", callback.Headers.Location!.OriginalString);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        Assert.Contains("no-store", me.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        using JsonDocument json = JsonDocument.Parse(await me.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        string[] properties = json.RootElement.EnumerateObject().Select(p => p.Name).Order().ToArray();
        Assert.Equal(["avatarUrl", "displayName", "id", "preferredLanguage"], properties);
        Assert.Equal("Ada Lovelace", json.RootElement.GetProperty("displayName").GetString());
        Assert.Equal("https://lh3.googleusercontent.com/a/avatar", json.RootElement.GetProperty("avatarUrl").GetString());
    }

    [Fact]
    public async Task Session_cookie_has_the_required_flags_and_holds_no_google_data()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);

        using HttpResponseMessage callback = await browser.SignInAsync();

        string session = Assert.Single(
            callback.Headers.GetValues("Set-Cookie"),
            c => c.StartsWith("__Host-Polymnia.Session=", StringComparison.Ordinal));
        AuthWithoutDatabaseTests.AssertCookieFlags(session, sameSite: "lax", httpOnly: true);
        Assert.Contains("expires=", session, StringComparison.OrdinalIgnoreCase);

        // The cookie is an opaque key; the database only holds its hash.
        string key = browser.SessionCookie!;
        bool rawKeyStored = await WithDbAsync(app, db => db.Sessions.AnyAsync(s => s.KeyHash == key, TestContext.Current.CancellationToken));
        Assert.False(rawKeyStored);
        Assert.Equal(1, await SessionCountAsync(app));
    }

    [Fact]
    public async Task Logout_needs_the_antiforgery_header_and_then_ends_the_session_even_for_a_copied_cookie()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        using (await browser.SignInAsync())
        {
        }

        string copiedCookie = browser.SessionCookie!;
        string token = await browser.FetchAntiforgeryTokenAsync();

        using HttpResponseMessage noHeader = await browser.SendAsync(HttpMethod.Post, "/api/auth/logout");
        using HttpResponseMessage wrongHeader = await browser.SendAsync(HttpMethod.Post, "/api/auth/logout", xsrfHeader: token + "x");
        using HttpResponseMessage stillIn = await browser.GetAsync("/api/me");
        using HttpResponseMessage logout = await browser.SendAsync(HttpMethod.Post, "/api/auth/logout", xsrfHeader: token);
        using HttpResponseMessage after = await browser.GetAsync("/api/me");

        Assert.Equal(HttpStatusCode.BadRequest, noHeader.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, wrongHeader.StatusCode);
        Assert.Equal(HttpStatusCode.OK, stillIn.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);

        // A copy of the cookie taken before the logout is worthless now: the session is gone on the server.
        var attacker = new TestBrowser(app);
        attacker.SetCookie("__Host-Polymnia.Session", copiedCookie);
        using HttpResponseMessage replay = await attacker.GetAsync("/api/me");
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
        Assert.Equal(0, await SessionCountAsync(app));
    }

    [Fact]
    public async Task Antiforgery_endpoint_sets_a_js_readable_token_cookie_an_httponly_cookie_and_no_body()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);

        using HttpResponseMessage response = await browser.SendAsync(HttpMethod.Get, "/api/auth/antiforgery");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(await response.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        string[] cookies = response.Headers.GetValues("Set-Cookie").ToArray();
        string requestToken = Assert.Single(cookies, c => c.StartsWith("__Host-XSRF-TOKEN=", StringComparison.Ordinal));
        string cookieToken = Assert.Single(cookies, c => c.StartsWith("__Host-Polymnia.Antiforgery=", StringComparison.Ordinal));
        AuthWithoutDatabaseTests.AssertCookieFlags(requestToken, sameSite: "strict", httpOnly: false);
        AuthWithoutDatabaseTests.AssertCookieFlags(cookieToken, sameSite: "strict", httpOnly: true);
    }

    [Fact]
    public void Antiforgery_endpoint_carries_the_no_compression_marker()
    {
        using var app = new TestApp();
        var endpoints = app.Services.GetRequiredService<Microsoft.AspNetCore.Routing.EndpointDataSource>().Endpoints;

        var antiforgery = endpoints.Single(e => (e as Microsoft.AspNetCore.Routing.RouteEndpoint)?.RoutePattern.RawText == "/api/auth/antiforgery");

        Assert.NotNull(antiforgery.Metadata.GetMetadata<Polymnia.Api.Hosting.DisableResponseCompressionAttribute>());
    }

    [Fact]
    public async Task A_token_issued_to_an_anonymous_visitor_is_not_valid_for_the_signed_in_user()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        string anonymousToken = await browser.FetchAntiforgeryTokenAsync();
        using (await browser.SignInAsync())
        {
        }

        using HttpResponseMessage stale = await browser.SendAsync(HttpMethod.Post, "/api/auth/logout", xsrfHeader: anonymousToken);
        string fresh = await browser.FetchAntiforgeryTokenAsync();
        using HttpResponseMessage ok = await browser.SendAsync(HttpMethod.Post, "/api/auth/logout", xsrfHeader: fresh);

        Assert.Equal(HttpStatusCode.BadRequest, stale.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, ok.StatusCode);
    }

    [Fact]
    public async Task A_token_of_another_session_is_rejected()
    {
        using TestApp app = await StartAsync();
        var alice = new TestBrowser(app);
        using (await alice.SignInAsync())
        {
        }

        app.Google.Subject = "sub-" + Guid.NewGuid().ToString("N");
        var bob = new TestBrowser(app);
        using (await bob.SignInAsync())
        {
        }

        string alicesToken = await alice.FetchAntiforgeryTokenAsync();
        string bobsToken = await bob.FetchAntiforgeryTokenAsync();

        using HttpResponseMessage crossed = await bob.SendAsync(HttpMethod.Post, "/api/auth/logout", xsrfHeader: alicesToken);
        using HttpResponseMessage own = await bob.SendAsync(HttpMethod.Post, "/api/auth/logout", xsrfHeader: bobsToken);

        Assert.Equal(HttpStatusCode.BadRequest, crossed.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, own.StatusCode);
    }

    [Theory]
    [InlineData("https://evil.example/phish", "/")]
    [InlineData("//evil.example", "/")]
    [InlineData("/\\evil.example", "/")]
    [InlineData("/scores?id=1", "/scores?id=1")]
    public async Task Open_redirect_is_rejected_after_sign_in(string returnUrl, string expectedLocation)
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);

        using HttpResponseMessage callback = await browser.SignInAsync(returnUrl);

        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal(expectedLocation, callback.Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task Signing_in_when_already_signed_in_does_not_go_to_google_and_ignores_a_foreign_return_url()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        using (await browser.SignInAsync())
        {
        }

        using HttpResponseMessage again = await browser.GetAsync("/api/auth/login?returnUrl=" + Uri.EscapeDataString("https://evil.example"));

        Assert.Equal(HttpStatusCode.Redirect, again.StatusCode);
        Assert.Equal("/", again.Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task First_sign_in_creates_the_user_and_the_next_one_updates_it()
    {
        using TestApp app = await StartAsync();
        string subject = app.Google.Subject;
        var first = new TestBrowser(app);
        using (await first.SignInAsync())
        {
        }

        User created = await WithDbAsync(app, db => db.Users.AsNoTracking().SingleAsync(u => u.GoogleSubject == subject, TestContext.Current.CancellationToken));

        app.Google.Name = "Ada King";
        app.Google.Picture = "https://evil.example/tracker.png";
        var second = new TestBrowser(app);
        using (await second.SignInAsync())
        {
        }

        User updated = await WithDbAsync(app, db => db.Users.AsNoTracking().SingleAsync(u => u.GoogleSubject == subject, TestContext.Current.CancellationToken));
        Assert.Equal(created.Id, updated.Id);
        Assert.Equal("Ada Lovelace", created.DisplayName);
        Assert.Equal("Ada King", updated.DisplayName);
        Assert.Null(updated.AvatarUrl); // not a Google user-content URL
        Assert.Equal(created.CreatedAt, updated.CreatedAt);
        Assert.True(updated.LastSeenAt >= created.LastSeenAt);
        Assert.Equal(2, await WithDbAsync(app, db => db.Sessions.CountAsync(s => s.UserId == created.Id, TestContext.Current.CancellationToken)));
    }

    [Fact]
    public async Task Concurrent_first_sign_ins_of_the_same_user_create_one_row()
    {
        using TestApp app = await StartAsync();
        string subject = app.Google.Subject;
        TestBrowser[] browsers = Enumerable.Range(0, 5).Select(_ => new TestBrowser(app)).ToArray();

        HttpResponseMessage[] responses = await Task.WhenAll(browsers.Select(b => b.SignInAsync()));

        foreach (HttpResponseMessage response in responses)
        {
            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
            response.Dispose();
        }

        Assert.Equal(1, await WithDbAsync(app, db => db.Users.CountAsync(u => u.GoogleSubject == subject, TestContext.Current.CancellationToken)));
    }

    [Fact]
    public async Task Deleting_the_user_ends_the_session()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        using (await browser.SignInAsync())
        {
        }

        string subject = app.Google.Subject;
        await WithDbAsync(app, async db => await db.Users.Where(u => u.GoogleSubject == subject).ExecuteDeleteAsync(TestContext.Current.CancellationToken));

        using HttpResponseMessage response = await browser.GetAsync("/api/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_session_past_its_absolute_lifetime_is_rejected_even_if_it_is_still_sliding()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        using (await browser.SignInAsync())
        {
        }

        await WithDbAsync(app, async db => await SessionsOf(db, app.Google.Subject).ExecuteUpdateAsync(
            s => s.SetProperty(x => x.AbsoluteExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)),
            TestContext.Current.CancellationToken));

        using HttpResponseMessage response = await browser.GetAsync("/api/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_session_idle_for_too_long_is_rejected()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        using (await browser.SignInAsync())
        {
        }

        await WithDbAsync(app, async db => await SessionsOf(db, app.Google.Subject).ExecuteUpdateAsync(
            s => s.SetProperty(x => x.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)),
            TestContext.Current.CancellationToken));

        using HttpResponseMessage response = await browser.GetAsync("/api/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_forged_or_unknown_session_cookie_is_anonymous()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        browser.SetCookie(AuthDefaults.SessionCookieName, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

        using HttpResponseMessage response = await browser.GetAsync("/api/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Sliding_renewal_moves_the_expiry_forward_but_never_past_the_absolute_limit()
    {
        using TestApp app = await StartAsync();
        Guid userId = await WithDbAsync(app, async db =>
            await new Polymnia.Infrastructure.Users.UserProvisioner(db, TimeProvider.System)
                .SignInAsync(app.Google.Subject, "Ada", null, TestContext.Current.CancellationToken));
        var store = app.Services.GetRequiredService<DbTicketStore>();
        var identity = new System.Security.Claims.ClaimsIdentity(
            [new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, userId.ToString())],
            AuthDefaults.CookieScheme);
        var properties = new Microsoft.AspNetCore.Authentication.AuthenticationProperties { ExpiresUtc = DateTimeOffset.UtcNow.AddHours(1) };
        var ticket = new Microsoft.AspNetCore.Authentication.AuthenticationTicket(
            new System.Security.Claims.ClaimsPrincipal(identity), properties, AuthDefaults.CookieScheme);

        string key = await store.StoreAsync(ticket, TestContext.Current.CancellationToken);
        properties.ExpiresUtc = DateTimeOffset.UtcNow.AddDays(2);
        await store.RenewAsync(key, ticket, TestContext.Current.CancellationToken);
        (DateTimeOffset expires, DateTimeOffset absolute) = await WithDbAsync(app, async db =>
        {
            var row = await SessionsOf(db, app.Google.Subject).AsNoTracking().SingleAsync(TestContext.Current.CancellationToken);
            return (row.ExpiresAt, row.AbsoluteExpiresAt);
        });
        Assert.InRange(expires, DateTimeOffset.UtcNow.AddDays(1.9), DateTimeOffset.UtcNow.AddDays(2.1));

        properties.ExpiresUtc = DateTimeOffset.UtcNow.AddDays(365);
        await store.RenewAsync(key, ticket, TestContext.Current.CancellationToken);
        DateTimeOffset capped = await WithDbAsync(app, async db =>
            (await SessionsOf(db, app.Google.Subject).AsNoTracking().SingleAsync(TestContext.Current.CancellationToken)).ExpiresAt);
        Assert.Equal(absolute, capped);
        Assert.InRange(absolute, DateTimeOffset.UtcNow.AddDays(29.9), DateTimeOffset.UtcNow.AddDays(30.1));
        Assert.NotNull(await store.RetrieveAsync(key, TestContext.Current.CancellationToken));

        await store.RemoveAsync(key, TestContext.Current.CancellationToken);
        Assert.Null(await store.RetrieveAsync(key, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Data_protection_keys_are_persisted_in_the_database()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        using (await browser.SignInAsync())
        {
        }

        Assert.True(await WithDbAsync(app, db => db.DataProtectionKeys.AnyAsync(TestContext.Current.CancellationToken)));
    }

    [Fact]
    public async Task A_session_survives_an_application_restart()
    {
        postgres.SkipIfUnavailable();
        var browser = default(TestBrowser);
        using (TestApp first = await StartAsync())
        {
            browser = new TestBrowser(first);
            using (await browser.SignInAsync())
            {
            }
        }

        // A new host, same database: the keys come from PostgreSQL, so the same cookie is still valid.
        using var second = new TestApp(connectionString: postgres.ConnectionString);
        var sameBrowser = new TestBrowser(second);
        sameBrowser.SetCookie(AuthDefaults.SessionCookieName, browser.SessionCookie!);

        using HttpResponseMessage response = await sameBrowser.GetAsync("/api/me");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
