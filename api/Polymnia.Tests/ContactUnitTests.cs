using Microsoft.Extensions.Options;
using MimeKit;
using Polymnia.Api.Contact;
using Polymnia.Core.Contact;
using Polymnia.Infrastructure.Contact;

namespace Polymnia.Tests;

/// <summary>Contact form rules that need neither a database nor a server: validation, e-mail building, options, backoff.</summary>
public sealed class ContactUnitTests
{
    [Theory]
    [InlineData("a@example.com", true)]
    [InlineData("first.last+tag@sub.example.co.uk", true)]
    [InlineData("a_b-c@example-site.org", true)]
    [InlineData("", false)]
    [InlineData("no-at-sign.example.com", false)]
    [InlineData("two@@example.com", false)]
    [InlineData("a@b", false)]
    [InlineData("a@example.123", false)]
    [InlineData(".a@example.com", false)]
    [InlineData("a..b@example.com", false)]
    [InlineData("a@-example.com", false)]
    [InlineData("a@exam_ple.com", false)]
    [InlineData("Name <a@example.com>", false)]
    [InlineData("\"a b\"@example.com", false)]
    [InlineData("a@example.com, b@example.com", false)]
    [InlineData("a@example.com;b@example.com", false)]
    [InlineData("a@example.com\r\nBcc: x@example.com", false)]
    [InlineData("a@example.com\nBcc: x@example.com", false)]
    [InlineData("a b@example.com", false)]
    [InlineData("a@example.com ", false)]
    [InlineData("a@exämple.com", false)]
    [InlineData("a(comment)@example.com", false)]
    public void An_address_must_be_one_plain_mailbox(string value, bool valid) =>
        Assert.Equal(valid, ContactAddress.IsValid(value));

    [Fact]
    public void An_address_has_a_length_limit()
    {
        Assert.False(ContactAddress.IsValid(new string('a', 65) + "@example.com"));
        Assert.False(ContactAddress.IsValid("a@" + new string('b', 250) + ".com"));
    }

    [Theory]
    [InlineData("Hello\r\nworld", "Hello\nworld")]
    [InlineData("  padded \n", "padded")]
    [InlineData("tab\there", "tab\there")]
    [InlineData("emoji \U0001F3B5 and accents éàü", "emoji \U0001F3B5 and accents éàü")]
    public void Text_is_normalized_and_accepted(string input, string expected) =>
        Assert.Equal(expected, ContactText.Clean(input));

    [Theory]
    [InlineData("null\0byte")]
    [InlineData("bell\a")]
    [InlineData("escape\u001b[31m")]
    [InlineData("c1\u0085control")]
    public void Text_with_characters_that_have_no_place_in_a_message_is_refused(string input) =>
        Assert.Null(ContactText.Clean(input));

    [Theory]
    [InlineData(0xD800)] // high surrogate without its pair
    [InlineData(0xDC00)] // low surrogate without its pair
    [InlineData(0x202A)] // bidirectional embedding
    [InlineData(0x202E)] // right-to-left override
    [InlineData(0x2066)] // isolate
    [InlineData(0x2069)]
    [InlineData(0x2028)] // line separator
    [InlineData(0x2029)] // paragraph separator
    [InlineData(0xFFFE)] // non-characters
    [InlineData(0xFFFF)]
    public void Text_with_a_bidirectional_override_or_a_separator_is_refused(int codePoint) =>
        Assert.Null(ContactText.Clean("before " + (char)codePoint + " after"));

    [Fact]
    public void Joiners_used_by_emoji_and_scripts_are_kept() =>
        Assert.NotNull(ContactText.Clean("family " + (char)0x200D + " joiner"));

    [Theory]
    [InlineData("personal-data", ContactTopic.PersonalData)]
    [InlineData("question", ContactTopic.Question)]
    [InlineData("report", ContactTopic.Report)]
    [InlineData("other", ContactTopic.Other)]
    public void Topics_round_trip(string name, ContactTopic topic)
    {
        Assert.True(ContactTopics.TryParse(name, out ContactTopic parsed));
        Assert.Equal(topic, parsed);
        Assert.Equal(name, ContactTopics.Name(topic));
    }

    [Theory]
    [InlineData("Question")]
    [InlineData("0")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("personal_data")]
    public void Anything_but_the_four_topic_names_is_refused(string? value) =>
        Assert.False(ContactTopics.TryParse(value, out _));

    private static ContactOptions SmtpOptions() => new()
    {
        ForwardTo = "operator@forward.example",
        From = "polymnia@sender.example",
        SmtpHost = "smtp.example",
    };

    private static MimeMessage Build(ContactMail mail) => ContactMailBuilder.Build(mail, SmtpOptions());

    private static ContactMail Mail(string? replyTo = null, string message = "Hello there") =>
        new(Guid.Parse("11111111-2222-3333-4444-555555555555"), new DateTimeOffset(2026, 11, 27, 10, 0, 0, TimeSpan.Zero), ContactTopic.Question, message, replyTo);

    [Fact]
    public void The_reply_address_goes_in_Reply_To_only_never_in_From()
    {
        MimeMessage message = Build(Mail("visitor@visitor.example"));

        Assert.Equal("visitor@visitor.example", Assert.Single(message.ReplyTo.Mailboxes).Address);
        Assert.Equal("polymnia@sender.example", Assert.Single(message.From.Mailboxes).Address);
        Assert.Equal("operator@forward.example", Assert.Single(message.To.Mailboxes).Address);
        Assert.DoesNotContain("visitor@visitor.example", message.From.ToString(), StringComparison.Ordinal);
        Assert.Empty(message.Cc);
        Assert.Empty(message.Bcc);
    }

    [Theory]
    [InlineData("a@example.com\r\nBcc: evil@example.com")]
    [InlineData("a@example.com\nBcc: evil@example.com")]
    [InlineData("a@example.com, evil@example.com")]
    [InlineData("Name <a@example.com>")]
    public void A_reply_address_that_is_not_a_plain_address_never_reaches_a_header(string replyTo)
    {
        MimeMessage message = Build(Mail(replyTo));

        Assert.Empty(message.ReplyTo);
        Assert.Empty(message.Bcc);
        string raw = message.ToString();
        Assert.DoesNotContain("evil@example.com", raw, StringComparison.Ordinal);
        Assert.DoesNotContain("Bcc:", raw, StringComparison.Ordinal);
    }

    [Fact]
    public void The_subject_is_fixed_text_and_the_message_stays_in_the_body()
    {
        string hostile = "Subject: forged\r\nBcc: evil@example.com\r\n\r\nbody";
        MimeMessage message = Build(Mail(message: hostile));

        Assert.Equal("[Polymnia] Question (11111111)", message.Subject);
        Assert.Empty(message.Bcc);
        string headers = string.Join("\n", message.Headers.Select(x => x.Field + ": " + x.Value));
        Assert.DoesNotContain("evil@example.com", headers, StringComparison.Ordinal);
        Assert.DoesNotContain("forged", headers, StringComparison.Ordinal);
        Assert.Contains("Bcc: evil@example.com", message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_message_id_uses_the_sender_domain_not_the_machine_name()
    {
        MimeMessage message = Build(Mail());

        Assert.EndsWith("@sender.example", message.MessageId, StringComparison.Ordinal);
        Assert.DoesNotContain(Environment.MachineName, message.MessageId!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Non_ASCII_text_survives_the_encoding()
    {
        MimeMessage built = Build(Mail(message: "Bonjour, ça va très bien ? \U0001F3B5"));
        using var stream = new MemoryStream();
        built.WriteTo(stream, TestContext.Current.CancellationToken);
        stream.Position = 0;

        MimeMessage parsed = MimeMessage.Load(stream, TestContext.Current.CancellationToken);

        Assert.Contains("Bonjour, ça va très bien ? \U0001F3B5", parsed.TextBody, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(1, 1)]
    [InlineData(2, 2)]
    [InlineData(3, 4)]
    [InlineData(4, 8)]
    [InlineData(7, 60)]
    [InlineData(8, 60)]
    [InlineData(50, 60)]
    public void Retries_back_off_exponentially_up_to_an_hour(int attempts, int minutes) =>
        Assert.Equal(TimeSpan.FromMinutes(minutes), ContactStore.Backoff(attempts));

    private static List<string> Failures(ContactOptions options)
    {
        ValidateOptionsResult result = new ContactOptionsValidator().Validate(null, options);
        return result.Failures?.ToList() ?? [];
    }

    [Fact]
    public void Without_any_smtp_setting_the_options_are_valid_and_nothing_is_forwarded()
    {
        var options = new ContactOptions();

        Assert.Empty(Failures(options));
        Assert.False(options.SmtpConfigured);
    }

    [Fact]
    public void A_complete_smtp_setup_is_valid()
    {
        ContactOptions options = SmtpOptions();
        options.SmtpUser = "u";
        options.SmtpPassword = "p";

        Assert.Empty(Failures(options));
        Assert.True(options.SmtpConfigured);
    }

    [Fact]
    public void A_partial_smtp_setup_is_refused_naming_the_missing_keys_never_a_value()
    {
        var options = new ContactOptions { ForwardTo = "operator@forward.example", SmtpPassword = "very-secret-value" };

        string all = string.Join('|', Failures(options));

        Assert.Contains("Contact:SmtpHost", all, StringComparison.Ordinal);
        Assert.Contains("Contact:From", all, StringComparison.Ordinal);
        Assert.Contains("Contact:SmtpUser and Contact:SmtpPassword", all, StringComparison.Ordinal);
        Assert.DoesNotContain("very-secret-value", all, StringComparison.Ordinal);
        Assert.DoesNotContain("operator@forward.example", all, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("ForwardTo", "not an address")]
    [InlineData("From", "a@example.com, b@example.com")]
    [InlineData("SmtpHost", "smtp.example.com/evil")]
    public void Invalid_smtp_values_are_refused(string property, string value)
    {
        ContactOptions options = SmtpOptions();
        typeof(ContactOptions).GetProperty(property)!.SetValue(options, value);

        Assert.NotEmpty(Failures(options));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(3651)]
    public void The_retention_must_be_between_one_day_and_ten_years(int days) =>
        Assert.Contains("Contact:RetentionDays", string.Join('|', Failures(new ContactOptions { RetentionDays = days })), StringComparison.Ordinal);
}
