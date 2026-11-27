namespace Polymnia.Core.Contact;

/// <summary>What a message is about. The wire values are the kebab-case names (<see cref="ContactTopics"/>).</summary>
public enum ContactTopic
{
    PersonalData = 0,
    Question = 1,
    Report = 2,
    Other = 3,
}

/// <summary>Where a message is in its journey to the operator's mailbox.</summary>
public enum ContactStatus
{
    /// <summary>Stored, waiting for the forwarder (first try or a retry).</summary>
    Pending = 0,

    /// <summary>Forwarded by e-mail.</summary>
    Sent = 1,

    /// <summary>Every attempt failed: kept for the operator to read in the database until the retention purge.</summary>
    Failed = 2,

    /// <summary>Stored only: no SMTP server is configured, so nothing is forwarded.</summary>
    Stored = 3,
}

/// <summary>
/// A message sent through the contact form. Anonymous by design: no user id, no client address, no user agent.
/// The reply address, when given, is personal data: it is purged with the message (<c>Contact:RetentionDays</c>).
/// </summary>
public sealed class ContactMessage
{
    public Guid Id { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public ContactTopic Topic { get; set; }

    public string Message { get; set; } = string.Empty;

    /// <summary>The optional address the sender wants an answer at. Only ever used as <c>Reply-To</c>.</summary>
    public string? ReplyTo { get; set; }

    public ContactStatus Status { get; set; }

    /// <summary>Delivery attempts made so far.</summary>
    public int Attempts { get; set; }

    /// <summary>When the forwarder may try again (null once sent, failed or stored only).</summary>
    public DateTimeOffset? NextAttemptAt { get; set; }

    /// <summary>A forwarder that claimed the message holds it until then (several instances never send it twice).</summary>
    public DateTimeOffset? LockedUntil { get; set; }

    public DateTimeOffset? SentAt { get; set; }

    /// <summary>Type name of the last delivery error. Never a message: server answers can quote addresses.</summary>
    public string? LastError { get; set; }
}

/// <summary>Limits of the form, shared by the validation, the database and the documentation.</summary>
public static class ContactLimits
{
    public const int MaxMessageLength = 2000;
    public const int MaxReplyToLength = 254;
}

/// <summary>Wire names of the topics.</summary>
public static class ContactTopics
{
    public static string Name(ContactTopic topic) => topic switch
    {
        ContactTopic.PersonalData => "personal-data",
        ContactTopic.Question => "question",
        ContactTopic.Report => "report",
        ContactTopic.Other => "other",
        _ => throw new ArgumentOutOfRangeException(nameof(topic)),
    };

    /// <summary>Strict: only the four names, in lower case. Numbers and anything else are refused.</summary>
    public static bool TryParse(string? value, out ContactTopic topic)
    {
        switch (value)
        {
            case "personal-data":
                topic = ContactTopic.PersonalData;
                return true;
            case "question":
                topic = ContactTopic.Question;
                return true;
            case "report":
                topic = ContactTopic.Report;
                return true;
            case "other":
                topic = ContactTopic.Other;
                return true;
            default:
                topic = default;
                return false;
        }
    }
}
