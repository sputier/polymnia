using System.Globalization;
using System.Net.Security;
using System.Text;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;
using MimeKit.Utils;
using Polymnia.Core.Contact;

namespace Polymnia.Api.Contact;

/// <summary>What the forwarder hands to the transport: a stored message, nothing else.</summary>
internal sealed record ContactMail(Guid Id, DateTimeOffset CreatedAt, ContactTopic Topic, string Message, string? ReplyTo);

/// <summary>Sends one forwarded message. A failure is an exception; the forwarder retries.</summary>
internal interface IContactMailTransport
{
    Task SendAsync(ContactMail mail, CancellationToken ct);
}

/// <summary>
/// Builds the e-mail. Nothing the visitor typed is ever put in a header except the reply address, in <c>Reply-To</c>
/// (never <c>From</c>) and only when it is a plain address: the subject is fixed text, and the message goes in the
/// body, where a line break is only a line break.
/// </summary>
internal static class ContactMailBuilder
{
    public static MimeMessage Build(ContactMail mail, ContactOptions options)
    {
        ArgumentNullException.ThrowIfNull(mail);
        ArgumentNullException.ThrowIfNull(options);

        string from = options.From!.Trim();
        MimeMessage message = new();
        message.From.Add(new MailboxAddress("Polymnia", from));
        message.To.Add(MailboxAddress.Parse(options.ForwardTo!.Trim()));
        if (mail.ReplyTo is { } replyTo && ContactAddress.IsValid(replyTo))
        {
            message.ReplyTo.Add(new MailboxAddress(null, replyTo));
        }

        message.Subject = $"[Polymnia] {Label(mail.Topic)} ({mail.Id.ToString("N", CultureInfo.InvariantCulture)[..8]})";
        message.Date = mail.CreatedAt;
        // The default Message-ID carries the machine's own host name: use the domain of the sender address instead.
        message.MessageId = MimeUtils.GenerateMessageId(from[(from.IndexOf('@', StringComparison.Ordinal) + 1)..]);

        StringBuilder body = new();
        body.Append("Topic: ").Append(ContactTopics.Name(mail.Topic)).Append('\n');
        body.Append("Received: ").Append(mail.CreatedAt.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss 'UTC'", CultureInfo.InvariantCulture)).Append('\n');
        body.Append("Id: ").Append(mail.Id).Append('\n');
        body.Append("Reply-To: ").Append(message.ReplyTo.Count > 0 ? "set (reply to this e-mail)" : "none given").Append("\n\n");
        body.Append(mail.Message).Append('\n');
        message.Body = new TextPart("plain") { Text = body.ToString() };
        return message;
    }

    private static string Label(ContactTopic topic) => topic switch
    {
        ContactTopic.PersonalData => "Personal data request",
        ContactTopic.Question => "Question",
        ContactTopic.Report => "Report",
        _ => "Other",
    };
}

/// <summary>
/// SMTP over MailKit (MIT). TLS is not optional: <c>StartTls</c> fails when the server does not offer STARTTLS (no silent
/// fall back to a clear connection) and <c>Implicit</c> starts TLS at once. Every step is bounded by the timeout.
/// </summary>
internal sealed class SmtpContactMailTransport(IOptions<ContactOptions> options) : IContactMailTransport
{
    /// <summary>Test hook: the tests' fake server has a self-signed certificate. Production never sets it.</summary>
    internal RemoteCertificateValidationCallback? CertificateValidation { get; init; }

    public async Task SendAsync(ContactMail mail, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(mail);

        ContactOptions o = options.Value;
        using MimeMessage message = ContactMailBuilder.Build(mail, o);
        // LocalDomain is what EHLO announces: the domain of the sender address, not the container's own name.
        string from = o.From!.Trim();
        using SmtpClient client = new()
        {
            Timeout = o.SmtpTimeoutSeconds * 1000,
            LocalDomain = from[(from.IndexOf('@', StringComparison.Ordinal) + 1)..],
        };
        if (CertificateValidation is not null)
        {
            client.ServerCertificateValidationCallback = CertificateValidation;
        }

        // The hard stop covers what the socket timeout does not (a server that answers one byte at a time).
        using CancellationTokenSource deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(o.SmtpTimeoutSeconds * 4L));

        await client.ConnectAsync(
            o.SmtpHost!.Trim(),
            o.SmtpPort,
            o.SmtpSecurity == SmtpSecurity.Implicit ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls,
            deadline.Token);
        if (!string.IsNullOrEmpty(o.SmtpUser))
        {
            await client.AuthenticateAsync(o.SmtpUser, o.SmtpPassword ?? string.Empty, deadline.Token);
        }

        await client.SendAsync(message, deadline.Token);

        // The server has accepted the message: a failed QUIT must not turn it into a failure (it would be sent again).
        try
        {
            await client.DisconnectAsync(true, deadline.Token);
        }
#pragma warning disable CA1031 // Sent already; the client is disposed (and the socket closed) right after.
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
#pragma warning restore CA1031
        {
            // Nothing to do.
        }
    }
}
