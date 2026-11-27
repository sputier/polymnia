using Microsoft.Extensions.Options;

namespace Polymnia.Api.Auth;

/// <summary>Binds the <c>Auth</c> configuration section. Secrets come from user-secrets or environment variables only.</summary>
internal sealed class AuthOptions
{
    public const string SectionName = "Auth";

    /// <summary>
    /// Public origin of the application, for example <c>https://polymnia.example</c>. The OAuth redirect URI is
    /// built from it, never from the request <c>Host</c> header.
    /// </summary>
    public string? PublicBaseUrl { get; set; }

    public GoogleAuthOptions Google { get; set; } = new();

    /// <summary>Sliding expiration: a session unused for this long ends.</summary>
    public TimeSpan IdleTimeout { get; set; } = TimeSpan.FromDays(7);

    /// <summary>Hard limit: a session never outlives this, however active it is.</summary>
    public TimeSpan AbsoluteTimeout { get; set; } = TimeSpan.FromDays(30);

    public bool GoogleConfigured =>
        !string.IsNullOrWhiteSpace(Google.ClientId) && !string.IsNullOrWhiteSpace(Google.ClientSecret);

    /// <summary>The redirect URI registered at Google, or <c>null</c> when <see cref="PublicBaseUrl"/> is unusable.</summary>
    public string? RedirectUri =>
        Uri.TryCreate(PublicBaseUrl, UriKind.Absolute, out Uri? baseUri)
            ? baseUri.GetLeftPart(UriPartial.Authority) + AuthDefaults.CallbackPath
            : null;
}

internal sealed class GoogleAuthOptions
{
    public string? ClientId { get; set; }

    public string? ClientSecret { get; set; }
}

/// <summary>Fails the start-up on an unusable configuration. Messages never contain configuration values.</summary>
internal sealed class AuthOptionsValidator(IHostEnvironment environment) : IValidateOptions<AuthOptions>
{
    public ValidateOptionsResult Validate(string? name, AuthOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        List<string> failures = [];
        bool hasId = !string.IsNullOrWhiteSpace(options.Google.ClientId);
        bool hasSecret = !string.IsNullOrWhiteSpace(options.Google.ClientSecret);

        if (!environment.IsDevelopment())
        {
            if (!hasId)
            {
                failures.Add("Auth:Google:ClientId is required outside Development.");
            }

            if (!hasSecret)
            {
                failures.Add("Auth:Google:ClientSecret is required outside Development.");
            }
        }
        else if (hasId != hasSecret)
        {
            failures.Add("Auth:Google:ClientId and Auth:Google:ClientSecret must be set together.");
        }

        if (hasId && hasSecret || !environment.IsDevelopment())
        {
            ValidatePublicBaseUrl(options, failures);
        }

        if (options.IdleTimeout <= TimeSpan.Zero || options.AbsoluteTimeout <= TimeSpan.Zero)
        {
            failures.Add("Auth:IdleTimeout and Auth:AbsoluteTimeout must be positive.");
        }
        else if (options.IdleTimeout > options.AbsoluteTimeout)
        {
            failures.Add("Auth:IdleTimeout must not exceed Auth:AbsoluteTimeout.");
        }

        return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private void ValidatePublicBaseUrl(AuthOptions options, List<string> failures)
    {
        if (!Uri.TryCreate(options.PublicBaseUrl, UriKind.Absolute, out Uri? uri))
        {
            failures.Add("Auth:PublicBaseUrl must be an absolute URL (for example https://polymnia.example).");
            return;
        }

        bool loopbackHttp = environment.IsDevelopment() && uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback;
        if (uri.Scheme != Uri.UriSchemeHttps && !loopbackHttp)
        {
            failures.Add("Auth:PublicBaseUrl must use https (http is accepted for localhost in Development only).");
        }

        if (uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)
            || !string.IsNullOrEmpty(uri.UserInfo))
        {
            failures.Add("Auth:PublicBaseUrl must be an origin only (scheme, host, optional port).");
        }
    }
}
