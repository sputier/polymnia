namespace Polymnia.Api.Auth;

internal static class AuthDefaults
{
    /// <summary>Cookie authentication scheme: the session.</summary>
    public const string CookieScheme = "Session";

    /// <summary>Remote (OpenID Connect) scheme for Google.</summary>
    public const string GoogleScheme = "Google";

    public const string CallbackPath = "/api/auth/callback";

    // "__Host-" cookies: Secure, Path=/, no Domain. The browser refuses them otherwise.
    public const string SessionCookieName = "__Host-Polymnia.Session";
    public const string CorrelationCookiePrefix = "__Host-Polymnia.Correlation.";
    public const string NonceCookiePrefix = "__Host-Polymnia.Nonce.";
    public const string AntiforgeryCookieName = "__Host-Polymnia.Antiforgery";

    /// <summary>Cookie, readable by JavaScript, that carries the antiforgery request token.</summary>
    public const string RequestTokenCookieName = "__Host-XSRF-TOKEN";

    public const string RequestTokenHeaderName = "X-XSRF-TOKEN";

    /// <summary>Claim of the session ticket: when the user last signed in with Google (Unix seconds, UTC).</summary>
    public const string AuthTimeClaim = "auth_time";

    /// <summary>Authentication property that makes the Google redirect ask the person to choose their account again.</summary>
    public const string ReauthProperty = "polymnia.reauth";

    public const string DataProtectionApplicationName = "Polymnia";
}
