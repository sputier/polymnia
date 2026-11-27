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

    /// <summary>Per-IP limit on <c>/api/auth/*</c>.</summary>
    public RateLimitOptions RateLimit { get; set; } = new();

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

internal sealed class RateLimitOptions
{
    public int PermitLimit { get; set; } = 60;

    public TimeSpan Window { get; set; } = TimeSpan.FromMinutes(1);
}

internal sealed class GoogleAuthOptions
{
    public string? ClientId { get; set; }

    public string? ClientSecret { get; set; }
}

/// <summary>Fails the start-up on an unusable configuration. Messages never contain configuration values.</summary>
internal sealed class AuthOptionsValidator(IHostEnvironment environment, IConfiguration configuration) : IValidateOptions<AuthOptions>
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

        if (!environment.IsDevelopment())
        {
            ValidateDeployment(failures);
        }

        if (options.RateLimit.PermitLimit < 1 || options.RateLimit.Window <= TimeSpan.Zero)
        {
            failures.Add("Auth:RateLimit:PermitLimit and Auth:RateLimit:Window must be positive.");
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

    /// <summary>Outside Development: a real host list and encrypted Data Protection keys are mandatory.</summary>
    private void ValidateDeployment(List<string> failures)
    {
        string? allowedHosts = configuration["AllowedHosts"];
        if (string.IsNullOrWhiteSpace(allowedHosts)
            || allowedHosts.Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Any(IsWildcardHost))
        {
            failures.Add("AllowedHosts must list the real host names, not be empty or \"*\" (outside Development).");
        }

        string? certificate = configuration["DataProtection:CertificatePath"];
        if (string.IsNullOrWhiteSpace(certificate))
        {
            failures.Add("DataProtection:CertificatePath is required outside Development (encrypts the Data Protection keys; see docs/authentication.md).");
        }
        else if (!File.Exists(certificate))
        {
            failures.Add("DataProtection:CertificatePath does not point to an existing file.");
        }
    }

    /// <summary>"*", "[*]" and either of them with a port ("*:443") accept every host.</summary>
    private static bool IsWildcardHost(string entry)
    {
        int colon = entry.LastIndexOf(':');
        string host = colon > 0 && !entry.EndsWith(']') ? entry[..colon] : entry;
        return host is "*" or "[*]";
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
