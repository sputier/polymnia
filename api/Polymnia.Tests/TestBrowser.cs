using System.Net;
using Polymnia.Api.Auth;

namespace Polymnia.Tests;

/// <summary>
/// A minimal browser: keeps cookies (by hand, so that tests can copy or replay them), never follows redirects
/// on its own, and can walk through the sign-in redirects.
/// </summary>
internal sealed class TestBrowser
{
    private readonly HttpClient _client;
    private readonly Dictionary<string, string> _cookies = [];

    public TestBrowser(TestApp app)
    {
        _client = app.CreateSecureClient();
    }

    public IReadOnlyDictionary<string, string> Cookies => _cookies;

    public string? SessionCookie => _cookies.GetValueOrDefault(AuthDefaults.SessionCookieName);

    public void SetCookie(string name, string value) => _cookies[name] = value;

    public void RemoveCookiesStartingWith(string prefix)
    {
        foreach (string name in _cookies.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal)).ToList())
        {
            _cookies.Remove(name);
        }
    }

    public async Task<HttpResponseMessage> SendAsync(
        HttpMethod method,
        string path,
        string? xsrfHeader = null,
        string? host = null,
        string? clientIp = null)
    {
        using var request = new HttpRequestMessage(method, path);
        if (clientIp is not null)
        {
            request.Headers.TryAddWithoutValidation(ClientIpStartupFilter.Header, clientIp);
        }

        if (_cookies.Count > 0)
        {
            request.Headers.TryAddWithoutValidation("Cookie", string.Join("; ", _cookies.Select(c => $"{c.Key}={c.Value}")));
        }

        if (xsrfHeader is not null)
        {
            request.Headers.TryAddWithoutValidation(AuthDefaults.RequestTokenHeaderName, xsrfHeader);
        }

        if (host is not null)
        {
            request.Headers.Host = host;
        }

        HttpResponseMessage response = await _client.SendAsync(request, TestContext.Current.CancellationToken);
        Absorb(response);
        return response;
    }

    public Task<HttpResponseMessage> GetAsync(string path) => SendAsync(HttpMethod.Get, path);

    /// <summary>Login, then the callback. Returns the response of the callback (the redirect to the return URL).</summary>
    public async Task<HttpResponseMessage> SignInAsync(string? returnUrl = null)
    {
        string url = "/api/auth/login" + (returnUrl is null ? string.Empty : "?returnUrl=" + Uri.EscapeDataString(returnUrl));
        using HttpResponseMessage login = await GetAsync(url);
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        return await GetAsync(login.Headers.Location!.OriginalString);
    }

    /// <summary>Fetches the antiforgery token (valid for the current identity) and returns it.</summary>
    public async Task<string> FetchAntiforgeryTokenAsync()
    {
        using HttpResponseMessage response = await GetAsync("/api/auth/antiforgery");
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        return _cookies[AuthDefaults.RequestTokenCookieName];
    }

    private void Absorb(HttpResponseMessage response)
    {
        if (!response.Headers.TryGetValues("Set-Cookie", out IEnumerable<string>? setCookies))
        {
            return;
        }

        foreach (string setCookie in setCookies)
        {
            string[] parts = setCookie.Split(';', StringSplitOptions.TrimEntries);
            int equals = parts[0].IndexOf('=', StringComparison.Ordinal);
            string name = parts[0][..equals];
            string value = parts[0][(equals + 1)..];
            bool expired = parts.Any(p => p.StartsWith("expires=", StringComparison.OrdinalIgnoreCase)
                && DateTimeOffset.TryParse(p["expires=".Length..], out DateTimeOffset when)
                && when < DateTimeOffset.UtcNow);
            if (value.Length == 0 || expired)
            {
                _cookies.Remove(name);
            }
            else
            {
                _cookies[name] = value;
            }
        }
    }
}
