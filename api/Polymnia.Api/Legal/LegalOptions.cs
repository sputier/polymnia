using Microsoft.Extensions.Options;

namespace Polymnia.Api.Legal;

/// <summary>
/// Binds the <c>Legal</c> section: who runs this instance. Nothing is hard-coded: the privacy page shows these
/// values. Outside Development the operator name, a contact and the hosting provider are mandatory.
/// </summary>
internal sealed class LegalOptions
{
    public const string SectionName = "Legal";
    public const int MaxFieldLength = 200;
    public const int MaxAddressLength = 400;

    /// <summary>Legal name of the person or organization that runs the instance (data controller).</summary>
    public string? OperatorName { get; set; }

    /// <summary>How to reach the operator about personal data: an e-mail address or an <c>https</c> URL.</summary>
    public string? Contact { get; set; }

    /// <summary>Optional postal address of the operator.</summary>
    public string? Address { get; set; }

    /// <summary>Hosting provider (a processor), for example the name of the company that hosts the server.</summary>
    public string? HostingProvider { get; set; }

    /// <summary>Optional country where the hosting provider stores the data.</summary>
    public string? HostingCountry { get; set; }

    /// <summary>How long the operator keeps the application logs (they only hold internal user ids), in days.</summary>
    public int LogRetentionDays { get; set; } = 30;
}

internal sealed class LegalOptionsValidator(IHostEnvironment environment) : IValidateOptions<LegalOptions>
{
    public ValidateOptionsResult Validate(string? name, LegalOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        List<string> failures = [];
        bool strict = !environment.IsDevelopment();

        Text(options.OperatorName, "Legal:OperatorName", LegalOptions.MaxFieldLength, strict, failures);
        Text(options.HostingProvider, "Legal:HostingProvider", LegalOptions.MaxFieldLength, strict, failures);
        Text(options.HostingCountry, "Legal:HostingCountry", LegalOptions.MaxFieldLength, false, failures);
        Text(options.Address, "Legal:Address", LegalOptions.MaxAddressLength, false, failures);

        if (string.IsNullOrWhiteSpace(options.Contact))
        {
            if (strict)
            {
                failures.Add("Legal:Contact is required outside Development (an e-mail address or an https URL).");
            }
        }
        else if (ContactKind(options.Contact) is null)
        {
            failures.Add("Legal:Contact must be an e-mail address or an https URL, without spaces or control characters.");
        }

        if (options.LogRetentionDays is < 1 or > 3650)
        {
            failures.Add("Legal:LogRetentionDays must be between 1 and 3650.");
        }

        return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    /// <summary><c>"email"</c>, <c>"url"</c> or <c>null</c> when the value is neither. The page links it, so it is strict.</summary>
    internal static string? ContactKind(string value)
    {
        ArgumentNullException.ThrowIfNull(value);

        string v = value.Trim();
        if (v.Length > LegalOptions.MaxFieldLength
            || v.Any(static c => char.IsControl(c) || char.IsWhiteSpace(c) || c is '<' or '>' or '"' or '\'' or '\\'))
        {
            return null;
        }

        if (Uri.TryCreate(v, UriKind.Absolute, out Uri? uri) && uri.Scheme == Uri.UriSchemeHttps
            && string.IsNullOrEmpty(uri.UserInfo) && !string.IsNullOrEmpty(uri.Host))
        {
            return "url";
        }

        int at = v.IndexOf('@', StringComparison.Ordinal);
        return at > 0 && at == v.LastIndexOf('@') && v.IndexOf('.', at) > at + 1 && !v.EndsWith('.')
            && !v.Contains(':', StringComparison.Ordinal)
                ? "email"
                : null;
    }

    private static void Text(string? value, string key, int max, bool required, List<string> failures)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            if (required)
            {
                failures.Add($"{key} is required outside Development.");
            }

            return;
        }

        if (value.Length > max || value.Any(static c => char.IsControl(c)))
        {
            failures.Add($"{key} must be at most {max} characters, without control characters.");
        }
    }
}
