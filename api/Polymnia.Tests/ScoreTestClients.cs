using System.Net;
using System.Security.Cryptography;
using Polymnia.Api.Auth;

namespace Polymnia.Tests;

/// <summary>Adds the session cookies and, on unsafe methods, the antiforgery header (like the front end does).</summary>
internal sealed class SessionHandler(string cookies, string xsrfToken, bool sendToken) : DelegatingHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        request.Headers.TryAddWithoutValidation("Cookie", cookies);
        bool unsafeMethod = request.Method != HttpMethod.Get && request.Method != HttpMethod.Head;
        if (sendToken && unsafeMethod && !request.Headers.Contains(AuthDefaults.RequestTokenHeaderName))
        {
            request.Headers.TryAddWithoutValidation(AuthDefaults.RequestTokenHeaderName, xsrfToken);
        }

        return base.SendAsync(request, cancellationToken);
    }
}

internal static class ScoreTestClients
{
    /// <summary>
    /// Signs a new user in through the real sign-in flow (Google is faked) and returns a client that carries the
    /// session cookie and the antiforgery header. Each call is a different user and a different client address, so
    /// the sign-in rate limit is never hit.
    /// </summary>
    public static async Task<HttpClient> SignInAsync(TestApp app, bool sendToken = true)
    {
        app.Google.Subject = "sub-" + Guid.NewGuid().ToString("N");
        var browser = new TestBrowser(app);
        byte[] r = RandomNumberGenerator.GetBytes(3);
        string ip = $"10.{r[0]}.{r[1]}.{r[2]}";

        using HttpResponseMessage login = await browser.SendAsync(HttpMethod.Get, "/api/auth/login", clientIp: ip);
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        using HttpResponseMessage callback = await browser.SendAsync(HttpMethod.Get, login.Headers.Location!.OriginalString, clientIp: ip);
        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        using HttpResponseMessage token = await browser.SendAsync(HttpMethod.Get, "/api/auth/antiforgery", clientIp: ip);
        Assert.Equal(HttpStatusCode.NoContent, token.StatusCode);

        string cookies = string.Join("; ", browser.Cookies.Select(c => $"{c.Key}={c.Value}"));
        string xsrf = browser.Cookies[AuthDefaults.RequestTokenCookieName];
        return app.CreateDefaultClient(new Uri(TestApp.PublicBaseUrl), new SessionHandler(cookies, xsrf, sendToken));
    }
}
