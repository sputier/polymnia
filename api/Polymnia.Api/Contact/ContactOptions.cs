using Microsoft.Extensions.Options;

namespace Polymnia.Api.Contact;

/// <summary>How the SMTP connection is secured. There is deliberately no "none": credentials and messages never travel in clear.</summary>
internal enum SmtpSecurity
{
    /// <summary>Plain connection upgraded with STARTTLS, which is <b>required</b> (usually port 587).</summary>
    StartTls = 0,

    /// <summary>TLS from the first byte (usually port 465).</summary>
    Implicit = 1,
}

/// <summary>
/// Binds the <c>Contact</c> section (docs/contact.md). Without <see cref="ForwardTo"/>, <see cref="SmtpHost"/> and
/// <see cref="From"/> messages are only stored (and a warning is logged at start-up). Partial settings are refused.
/// </summary>
internal sealed class ContactOptions
{
    public const string SectionName = "Contact";

    /// <summary>The operator's mailbox the messages are forwarded to. Never shown anywhere.</summary>
    public string? ForwardTo { get; set; }

    public string? SmtpHost { get; set; }

    public int SmtpPort { get; set; } = 587;

    public SmtpSecurity SmtpSecurity { get; set; } = SmtpSecurity.StartTls;

    public string? SmtpUser { get; set; }

    public string? SmtpPassword { get; set; }

    /// <summary>
    /// A file that holds the SMTP password (a Docker secret keeps it out of the environment, where <c>docker inspect</c>
    /// shows it). When the file has content it wins over <see cref="SmtpPassword"/>; an empty file means "use the variable".
    /// Trailing line breaks are not part of the password.
    /// </summary>
    public string? SmtpPasswordFile { get; set; }

    internal static void ReadPasswordFile(ContactOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        if (string.IsNullOrWhiteSpace(options.SmtpPasswordFile))
        {
            return;
        }

        string content;
        try
        {
            content = File.ReadAllText(options.SmtpPasswordFile.Trim()).TrimEnd('\r', '\n');
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Neither the path nor the content is in the message.
            throw new InvalidOperationException("Contact:SmtpPasswordFile could not be read (missing file or permissions).", ex);
        }

        if (content.Length > 0)
        {
            options.SmtpPassword = content;
        }
    }

    /// <summary>The envelope and header <c>From</c> of the forwarded mails: an address the SMTP server lets you send as.</summary>
    public string? From { get; set; }

    /// <summary>Connect, TLS handshake and each command time out after this many seconds.</summary>
    public int SmtpTimeoutSeconds { get; set; } = 20;

    /// <summary>Days a message stays in the database before the purge deletes it.</summary>
    public int RetentionDays { get; set; } = 90;

    /// <summary>Messages per client address and per hour (IPv4 address or IPv6 /64).</summary>
    public int AddressPerHour { get; set; } = 5;

    /// <summary>Messages per hour, all clients together.</summary>
    public int GlobalPerHour { get; set; } = 200;

    /// <summary>Form tokens per client address and per hour (opening the page is cheap, so the budget is larger).</summary>
    public int TokensPerAddressPerHour { get; set; } = 60;

    /// <summary>A token is accepted at the earliest this many seconds after it was issued (nobody writes a message faster).</summary>
    public int MinFillSeconds { get; set; } = 2;

    /// <summary>A token is accepted at the latest this many minutes after it was issued.</summary>
    public int TokenLifetimeMinutes { get; set; } = 60;

    public bool SmtpConfigured =>
        !string.IsNullOrWhiteSpace(ForwardTo) && !string.IsNullOrWhiteSpace(SmtpHost) && !string.IsNullOrWhiteSpace(From);
}

internal sealed class ContactOptionsValidator : IValidateOptions<ContactOptions>
{
    public ValidateOptionsResult Validate(string? name, ContactOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        List<string> failures = [];
        bool any = !string.IsNullOrWhiteSpace(options.ForwardTo) || !string.IsNullOrWhiteSpace(options.SmtpHost)
            || !string.IsNullOrWhiteSpace(options.From) || !string.IsNullOrWhiteSpace(options.SmtpUser)
            || !string.IsNullOrWhiteSpace(options.SmtpPassword);
        if (any)
        {
            if (string.IsNullOrWhiteSpace(options.ForwardTo))
            {
                failures.Add("Contact:ForwardTo is required when an SMTP setting is given.");
            }
            else if (!ContactAddress.IsValid(options.ForwardTo.Trim()))
            {
                failures.Add("Contact:ForwardTo must be a plain e-mail address.");
            }

            if (string.IsNullOrWhiteSpace(options.From))
            {
                failures.Add("Contact:From is required when an SMTP setting is given.");
            }
            else if (!ContactAddress.IsValid(options.From.Trim()))
            {
                failures.Add("Contact:From must be a plain e-mail address.");
            }

            if (string.IsNullOrWhiteSpace(options.SmtpHost))
            {
                failures.Add("Contact:SmtpHost is required when an SMTP setting is given.");
            }
            else if (!IsHost(options.SmtpHost.Trim()))
            {
                failures.Add("Contact:SmtpHost must be a host name or an IP address.");
            }

            if (options.SmtpPort is < 1 or > 65535)
            {
                failures.Add("Contact:SmtpPort must be between 1 and 65535.");
            }

            // Both or none: a user without a password (or the opposite) is a typo, not a valid setup.
            if (string.IsNullOrWhiteSpace(options.SmtpUser) != string.IsNullOrWhiteSpace(options.SmtpPassword))
            {
                failures.Add("Contact:SmtpUser and Contact:SmtpPassword must be given together.");
            }

            if (options.SmtpTimeoutSeconds is < 1 or > 300)
            {
                failures.Add("Contact:SmtpTimeoutSeconds must be between 1 and 300.");
            }
        }

        if (options.RetentionDays is < 1 or > 3650)
        {
            failures.Add("Contact:RetentionDays must be between 1 and 3650.");
        }

        if (options.AddressPerHour < 1 || options.GlobalPerHour < 1 || options.TokensPerAddressPerHour < 1)
        {
            failures.Add("Contact:AddressPerHour, Contact:GlobalPerHour and Contact:TokensPerAddressPerHour must be positive.");
        }

        if (options.MinFillSeconds is < 0 or > 60 || options.TokenLifetimeMinutes is < 1 or > 1440)
        {
            failures.Add("Contact:MinFillSeconds must be 0 to 60 and Contact:TokenLifetimeMinutes 1 to 1440.");
        }

        return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private static bool IsHost(string value) =>
        value.Length <= 253
        && value.All(static c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or ':' or '_' or '[' or ']')
        && !value.StartsWith('.');
}
