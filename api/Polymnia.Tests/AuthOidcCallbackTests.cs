using System.Net;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Polymnia.Api.Auth;
using Polymnia.Infrastructure;

namespace Polymnia.Tests;

/// <summary>
/// The real OpenID Connect handler, end to end except for Google itself: a test RSA key published as a static
/// key set, a fake token endpoint and locally signed ID tokens. Needs Docker (sessions are stored in PostgreSQL).
/// </summary>
public sealed class AuthOidcCallbackTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private async Task<TestApp> StartAsync()
    {
        postgres.SkipIfUnavailable();
        var app = new TestApp(connectionString: postgres.ConnectionString, fakeGoogle: false);
        await app.MigrateAsync();
        return app;
    }

    /// <summary>Starts a sign-in and returns the <c>state</c> and <c>nonce</c> Google would receive.</summary>
    private static async Task<(string State, string Nonce)> BeginAsync(TestBrowser browser, string returnUrl = "/scores")
    {
        using HttpResponseMessage login = await browser.GetAsync("/api/auth/login?returnUrl=" + Uri.EscapeDataString(returnUrl));
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        var query = QueryHelpers.ParseQuery(login.Headers.Location!.Query);
        return (query["state"].ToString(), query["nonce"].ToString());
    }

    private static Task<HttpResponseMessage> CallbackAsync(TestBrowser browser, string state, string code = "auth-code") =>
        browser.GetAsync($"/api/auth/callback?code={code}&state={Uri.EscapeDataString(state)}");

    private static async Task AssertRejectedAsync(HttpResponseMessage callback, TestBrowser browser)
    {
        // Generic: back to the sign-in page, nothing about the cause, no session.
        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal("/?signin=failed", callback.Headers.Location!.OriginalString);
        Assert.Empty(await callback.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));
        Assert.Null(browser.SessionCookie);
        Assert.DoesNotContain(
            callback.Headers.TryGetValues("Set-Cookie", out IEnumerable<string>? cookies) ? cookies : [],
            c => c.StartsWith(AuthDefaults.SessionCookieName, StringComparison.Ordinal));
        using HttpResponseMessage me = await browser.GetAsync("/api/me");
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
    }

    [Fact]
    public async Task A_valid_id_token_signs_the_user_in_and_the_token_request_is_correct()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        (string state, string nonce) = await BeginAsync(browser);
        app.Oidc.NextIdToken = app.Oidc.CreateIdToken(nonce, subject: "sub-" + Guid.NewGuid().ToString("N"), name: "Grace Hopper");

        using HttpResponseMessage callback = await CallbackAsync(browser, state);

        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal("/scores", callback.Headers.Location!.OriginalString);
        Assert.NotNull(browser.SessionCookie);
        using HttpResponseMessage me = await browser.GetAsync("/api/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        Assert.Contains("Grace Hopper", await me.Content.ReadAsStringAsync(TestContext.Current.CancellationToken), StringComparison.Ordinal);

        // What the application sent to Google's token endpoint.
        Dictionary<string, string> request = app.Oidc.LastTokenRequest;
        Assert.Equal("authorization_code", request["grant_type"]);
        Assert.Equal("auth-code", request["code"]);
        Assert.Equal($"{TestApp.PublicBaseUrl}/api/auth/callback", request["redirect_uri"]);
        Assert.Equal(OidcTestServer.ClientId, request["client_id"]);
        Assert.False(string.IsNullOrEmpty(request["code_verifier"])); // PKCE
        Assert.False(string.IsNullOrEmpty(request["client_secret"]));

        // The sign-in left no correlation or nonce cookie behind.
        Assert.DoesNotContain(browser.Cookies.Keys, k => k.StartsWith("__Host-Polymnia.Correlation", StringComparison.Ordinal));
        Assert.DoesNotContain(browser.Cookies.Keys, k => k.StartsWith("__Host-Polymnia.Nonce", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_wrong_nonce_is_rejected()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        (string state, _) = await BeginAsync(browser);
        app.Oidc.NextIdToken = app.Oidc.CreateIdToken(nonce: "not-the-nonce-of-this-sign-in");

        using HttpResponseMessage callback = await CallbackAsync(browser, state);

        await AssertRejectedAsync(callback, browser);
    }

    [Fact]
    public async Task A_wrong_audience_is_rejected()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        (string state, string nonce) = await BeginAsync(browser);
        app.Oidc.NextIdToken = app.Oidc.CreateIdToken(nonce, audience: "another-client.apps.googleusercontent.com");

        using HttpResponseMessage callback = await CallbackAsync(browser, state);

        await AssertRejectedAsync(callback, browser);
    }

    [Fact]
    public async Task A_wrong_issuer_is_rejected()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        (string state, string nonce) = await BeginAsync(browser);
        app.Oidc.NextIdToken = app.Oidc.CreateIdToken(nonce, issuer: "https://evil.example");

        using HttpResponseMessage callback = await CallbackAsync(browser, state);

        await AssertRejectedAsync(callback, browser);
    }

    [Fact]
    public async Task An_expired_id_token_is_rejected()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        (string state, string nonce) = await BeginAsync(browser);
        app.Oidc.NextIdToken = app.Oidc.CreateIdToken(nonce, expired: true);

        using HttpResponseMessage callback = await CallbackAsync(browser, state);

        await AssertRejectedAsync(callback, browser);
    }

    [Fact]
    public async Task An_id_token_signed_by_an_unknown_key_is_rejected()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        (string state, string nonce) = await BeginAsync(browser);
        app.Oidc.NextIdToken = app.Oidc.CreateIdToken(nonce, signedByUnknownKey: true);

        using HttpResponseMessage callback = await CallbackAsync(browser, state);

        await AssertRejectedAsync(callback, browser);
    }

    [Fact]
    public async Task A_tampered_state_is_rejected_before_any_token_request()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        (string state, string nonce) = await BeginAsync(browser);
        app.Oidc.NextIdToken = app.Oidc.CreateIdToken(nonce);
        string tampered = state[..^2] + (state.EndsWith("AA", StringComparison.Ordinal) ? "BB" : "AA");

        using HttpResponseMessage callback = await CallbackAsync(browser, tampered);

        await AssertRejectedAsync(callback, browser);
        Assert.Equal(0, app.Oidc.TokenRequests);
    }

    [Fact]
    public async Task A_state_from_another_sign_in_is_rejected()
    {
        using TestApp app = await StartAsync();
        var victim = new TestBrowser(app);
        var attacker = new TestBrowser(app);
        (string attackerState, string attackerNonce) = await BeginAsync(attacker);
        await BeginAsync(victim);
        app.Oidc.NextIdToken = app.Oidc.CreateIdToken(attackerNonce);

        // Login CSRF: the victim's browser is sent to the callback with the attacker's state.
        using HttpResponseMessage callback = await CallbackAsync(victim, attackerState);

        await AssertRejectedAsync(callback, victim);
    }

    [Fact]
    public async Task A_callback_without_the_correlation_cookie_is_rejected_and_a_state_cannot_be_replayed()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        (string state, string nonce) = await BeginAsync(browser);
        app.Oidc.NextIdToken = app.Oidc.CreateIdToken(nonce);
        var stranger = new TestBrowser(app);

        using HttpResponseMessage noCookie = await CallbackAsync(stranger, state);
        using HttpResponseMessage first = await CallbackAsync(browser, state);
        using HttpResponseMessage replay = await CallbackAsync(browser, state);

        await AssertRejectedAsync(noCookie, stranger);
        Assert.Equal("/scores", first.Headers.Location!.OriginalString);
        Assert.Equal("/?signin=failed", replay.Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task Google_reporting_an_error_leads_to_a_generic_failure_without_details()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);
        (string state, _) = await BeginAsync(browser);
        app.Logs.Clear();

        using HttpResponseMessage callback = await browser.GetAsync(
            $"/api/auth/callback?error=access_denied&error_description=secret-details&state={Uri.EscapeDataString(state)}");

        await AssertRejectedAsync(callback, browser);
        Assert.DoesNotContain("secret-details", callback.Headers.Location!.OriginalString, StringComparison.Ordinal);
        Assert.Equal(0, app.Oidc.TokenRequests);
        // Audited at Warning, with the failure type only.
        Assert.Contains(app.Logs.Entries, e => e.EventId.Name == "AuthSignInFailed" && e.Level == LogLevel.Warning);
        Assert.DoesNotContain(app.Logs.Entries, e => e.Category == AuthLog.Category && e.Message.Contains("secret-details", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Sign_in_and_sign_out_are_audited_with_the_user_id_only()
    {
        using TestApp app = await StartAsync();
        string subject = "sub-" + Guid.NewGuid().ToString("N");
        var browser = new TestBrowser(app);
        (string state, string nonce) = await BeginAsync(browser);
        app.Oidc.NextIdToken = app.Oidc.CreateIdToken(nonce, subject: subject, name: "Audited Person");
        app.Logs.Clear();

        using (await CallbackAsync(browser, state))
        {
        }

        Guid userId = await WithDbAsync(app, db => db.Users.Where(u => u.GoogleSubject == subject).Select(u => u.Id).SingleAsync(TestContext.Current.CancellationToken));
        string token = await browser.FetchAntiforgeryTokenAsync();
        using (await browser.SendAsync(HttpMethod.Post, "/api/auth/logout", xsrfHeader: token))
        {
        }

        var audit = app.Logs.Entries.Where(e => e.EventId.Id is AuthLog.SignedInEventId or AuthLog.SignedOutEventId).ToList();
        Assert.Equal([AuthLog.SignedInEventId, AuthLog.SignedOutEventId], audit.Select(e => e.EventId.Id).ToArray());
        Assert.All(audit, e =>
        {
            Assert.Equal(LogLevel.Information, e.Level);
            Assert.Contains(userId.ToString("D"), e.Message, StringComparison.Ordinal);
        });
        string everything = string.Join('\n', app.Logs.Entries.Select(e => e.Message));
        Assert.DoesNotContain("Audited Person", everything, StringComparison.Ordinal);
        Assert.DoesNotContain(subject, everything, StringComparison.Ordinal);
        Assert.DoesNotContain(nonce, everything, StringComparison.Ordinal);
        Assert.DoesNotContain(browser.SessionCookie ?? "no-cookie", everything, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Sign_in_cookies_are_short_lived()
    {
        using TestApp app = await StartAsync();
        var browser = new TestBrowser(app);

        using HttpResponseMessage login = await browser.GetAsync("/api/auth/login");

        foreach (string cookie in login.Headers.GetValues("Set-Cookie"))
        {
            Assert.Contains("max-age=600", cookie.ToLowerInvariant(), StringComparison.Ordinal);
        }
    }

    private static async Task<T> WithDbAsync<T>(TestApp app, Func<PolymniaDbContext, Task<T>> action)
    {
        using IServiceScope scope = app.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<PolymniaDbContext>());
    }
}
