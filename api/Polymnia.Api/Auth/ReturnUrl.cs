namespace Polymnia.Api.Auth;

/// <summary>Open-redirect protection: the URL to return to after sign-in must be a local path.</summary>
internal static class ReturnUrl
{
    public const string Default = "/";

    private const int MaxLength = 2048;

    /// <summary>Returns <paramref name="value"/> when it is a local absolute path, <see cref="Default"/> otherwise.</summary>
    public static string Sanitize(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > MaxLength || value[0] != '/')
        {
            return Default;
        }

        // "//host" and "/\host" are protocol-relative for browsers; "\" and control characters are never legitimate.
        if (value.Length > 1 && (value[1] == '/' || value[1] == '\\'))
        {
            return Default;
        }

        foreach (char c in value)
        {
            if (c == '\\' || char.IsControl(c))
            {
                return Default;
            }
        }

        // Never bounce back into the auth endpoints (login loop).
        return value.StartsWith("/api/", StringComparison.OrdinalIgnoreCase) ? Default : value;
    }
}
