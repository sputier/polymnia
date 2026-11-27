namespace Polymnia.Api.Contact;

/// <summary>
/// Events of the contact form. A message id is the only thing about a message that is ever logged: never the text, the
/// reply address, the operator's address, the SMTP host or user, nor an exception message (server answers quote addresses).
/// </summary>
internal static partial class ContactLog
{
    public const string Category = "Polymnia.Contact";

    [LoggerMessage(EventId = 30, EventName = "ContactStored", Level = LogLevel.Information, Message = "Contact message {MessageId} stored.")]
    public static partial void Stored(ILogger logger, Guid messageId);

    [LoggerMessage(EventId = 31, EventName = "ContactHoneypot", Level = LogLevel.Information, Message = "Contact form: {Count} submissions filled the honeypot field and were dropped (logged at most once a minute).")]
    public static partial void Honeypot(ILogger logger, int count);

    [LoggerMessage(EventId = 32, EventName = "ContactSmtpNotConfigured", Level = LogLevel.Warning,
        Message = "Contact form: no SMTP server is configured (Contact:SmtpHost, Contact:ForwardTo and Contact:From). Messages are stored in the database but not forwarded by e-mail.")]
    public static partial void SmtpNotConfigured(ILogger logger);

    [LoggerMessage(EventId = 33, EventName = "ContactForwarded", Level = LogLevel.Information, Message = "Contact message {MessageId} forwarded (attempt {Attempt}).")]
    public static partial void Forwarded(ILogger logger, Guid messageId, int attempt);

    [LoggerMessage(EventId = 34, EventName = "ContactForwardFailed", Level = LogLevel.Warning,
        Message = "Contact message {MessageId} could not be forwarded ({ErrorType}), attempt {Attempt}, now {Status}.")]
    public static partial void ForwardFailed(ILogger logger, Guid messageId, string errorType, int attempt, string status);

    [LoggerMessage(EventId = 35, EventName = "ContactForwarderFailed", Level = LogLevel.Warning, Message = "The contact forwarder could not read the queue ({ErrorType}). It will try again.")]
    public static partial void ForwarderFailed(ILogger logger, string errorType);

    [LoggerMessage(EventId = 36, EventName = "ContactPurged", Level = LogLevel.Information, Message = "Removed {Count} contact messages older than {Days} days.")]
    public static partial void Purged(ILogger logger, int count, int days);

    [LoggerMessage(EventId = 37, EventName = "ContactPurgeFailed", Level = LogLevel.Warning, Message = "The contact message purge failed ({ErrorType}). It will try again.")]
    public static partial void PurgeFailed(ILogger logger, string errorType);

    [LoggerMessage(EventId = 38, EventName = "ContactRateLimited", Level = LogLevel.Information, Message = "Contact form: {Count} submissions were refused by a rate limit, the last one by the {Scope} budget (logged at most once a minute).")]
    public static partial void RateLimited(ILogger logger, int count, string scope);
}
