using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using MimeKit;
using Polymnia.Api.Contact;
using Polymnia.Core.Contact;
using Polymnia.Infrastructure;
using Polymnia.Infrastructure.Contact;

namespace Polymnia.Tests;

/// <summary>A clock the tests move by hand (token ages, retention).</summary>
internal sealed class MutableClock(DateTimeOffset start) : TimeProvider
{
    // Ticks in a long: read by the host's threads while the test thread advances it.
    private long _ticks = start.UtcTicks;

    public override DateTimeOffset GetUtcNow() => new(Interlocked.Read(ref _ticks), TimeSpan.Zero);

    public void Advance(TimeSpan by) => Interlocked.Add(ref _ticks, by.Ticks);
}

/// <summary>One PostgreSQL container for the contact tests, migrated once.</summary>
public sealed class ContactFixture : IAsyncLifetime
{
    public PostgresFixture Postgres { get; } = new();

    public async ValueTask InitializeAsync()
    {
        await Postgres.InitializeAsync();
        if (Postgres.UnavailableReason is not null)
        {
            return;
        }

        using var app = new TestApp(connectionString: Postgres.ConnectionString);
        await app.MigrateAsync();
    }

    public async ValueTask DisposeAsync() => await Postgres.DisposeAsync();
}

/// <summary>A test host with its own clock and, unless told otherwise, a fake SMTP server it forwards to.</summary>
internal sealed class ContactHarness : IDisposable
{
    public const string ForwardTo = "operator@forward.example";
    public const string From = "polymnia@sender.example";

    public ContactHarness(
        PostgresFixture postgres,
        FakeSmtpMode? smtp = FakeSmtpMode.StartTls,
        Dictionary<string, string?>? settings = null)
    {
        postgres.SkipIfUnavailable();
        Clock = new MutableClock(DateTimeOffset.UtcNow);
        Dictionary<string, string?> all = new()
        {
            ["Contact:MinFillSeconds"] = "2",
            ["Contact:AddressPerHour"] = "1000",
            ["Contact:GlobalPerHour"] = "1000",
            ["Contact:TokensPerAddressPerHour"] = "1000",
        };
        if (smtp is { } mode)
        {
            Smtp = new FakeSmtpServer(mode);
            all["Contact:ForwardTo"] = ForwardTo;
            all["Contact:From"] = From;
            all["Contact:SmtpHost"] = "127.0.0.1";
            all["Contact:SmtpPort"] = Smtp.Port.ToString(System.Globalization.CultureInfo.InvariantCulture);
            all["Contact:SmtpUser"] = FakeSmtpServer.User;
            all["Contact:SmtpPassword"] = FakeSmtpServer.Password;
            all["Contact:SmtpSecurity"] = mode == FakeSmtpMode.Implicit ? "Implicit" : "StartTls";
            all["Contact:SmtpTimeoutSeconds"] = "10";
        }

        foreach ((string key, string? value) in settings ?? [])
        {
            all[key] = value;
        }

        MutableClock clock = Clock;
        App = new TestApp(
            connectionString: postgres.ConnectionString,
            settings: all,
            configureServices: services =>
            {
                services.AddSingleton<TimeProvider>(clock);
                // The fake server's certificate is self-signed: the transport of the tests trusts it, production never does.
                // CA5359 is the point of the rule: it is on purpose, a test server with a self-signed certificate.
#pragma warning disable CA5359
                services.AddSingleton<IContactMailTransport>(sp =>
                    new SmtpContactMailTransport(sp.GetRequiredService<IOptions<ContactOptions>>()) { CertificateValidation = static (_, _, _, _) => true });
#pragma warning restore CA5359
            });
        Client = App.CreateSecureClient();
        Client.DefaultRequestHeaders.TryAddWithoutValidation(ClientIpStartupFilter.Header, RandomIp());
    }

    public TestApp App { get; }

    public FakeSmtpServer? Smtp { get; }

    public MutableClock Clock { get; }

    public HttpClient Client { get; }

    public static string RandomIp()
    {
        byte[] r = RandomNumberGenerator.GetBytes(3);
        return $"10.{r[0]}.{r[1]}.{r[2]}";
    }

    public HttpClient ClientFor(string ip)
    {
        HttpClient client = App.CreateSecureClient();
        client.DefaultRequestHeaders.TryAddWithoutValidation(ClientIpStartupFilter.Header, ip);
        return client;
    }

    /// <summary>Fetches a token and lets the minimum filling time pass.</summary>
    public async Task<string> TokenAsync(HttpClient? client = null, bool wait = true)
    {
        using HttpResponseMessage response = await (client ?? Client).GetAsync("/api/contact/form-token", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        JsonElement json = await response.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        if (wait)
        {
            Clock.Advance(TimeSpan.FromSeconds(3));
        }

        return json.GetProperty("token").GetString()!;
    }

    public async Task<HttpResponseMessage> PostAsync(object body, HttpClient? client = null)
    {
        using JsonContent content = JsonContent.Create(body);
        return await (client ?? Client).PostAsync("/api/contact", content, TestContext.Current.CancellationToken);
    }

    /// <summary>A valid submission: fetches a token, then posts.</summary>
    public async Task<HttpResponseMessage> SubmitAsync(
        string message, string topic = "question", string? replyTo = null, string? website = null, HttpClient? client = null)
    {
        string token = await TokenAsync(client);
        return await PostAsync(new { topic, message, replyTo, website, token }, client);
    }

    public async Task<List<ContactMessage>> RowsAsync(string? containing = null)
    {
        using IServiceScope scope = App.Services.CreateScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        List<ContactMessage> all = await db.ContactMessages.AsNoTracking().ToListAsync(TestContext.Current.CancellationToken);
        return containing is null ? all : [.. all.Where(m => m.Message.Contains(containing, StringComparison.Ordinal))];
    }

    public async Task<ContactMessage> WaitForRowAsync(string marker, Func<ContactMessage, bool> predicate, int seconds = 20)
    {
        DateTime deadline = DateTime.UtcNow.AddSeconds(seconds);
        List<ContactMessage> rows = [];
        while (DateTime.UtcNow < deadline)
        {
            rows = await RowsAsync(marker);
            if (rows.Count == 1 && predicate(rows[0]))
            {
                return rows[0];
            }

            await Task.Delay(50, TestContext.Current.CancellationToken);
        }

        throw new TimeoutException($"The message did not reach the expected state in time (rows: {rows.Count}, status: {rows.FirstOrDefault()?.Status}).");
    }

    public async Task SqlAsync(string sql, params object[] parameters)
    {
        using IServiceScope scope = App.Services.CreateScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        await db.Database.ExecuteSqlRawAsync(sql, parameters, TestContext.Current.CancellationToken);
    }

    public static string Marker() => "marker-" + Guid.NewGuid().ToString("N");

    public void Dispose()
    {
        Client.Dispose();
        App.Dispose();
        Smtp?.Dispose();
    }
}

/// <summary>The contact form against a real PostgreSQL (Testcontainers) and a fake SMTP server.</summary>
public sealed class ContactApiTests(ContactFixture fixture) : IClassFixture<ContactFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private ContactHarness Harness(FakeSmtpMode? smtp = FakeSmtpMode.StartTls, Dictionary<string, string?>? settings = null) =>
        new(fixture.Postgres, smtp, settings);

    private static async Task<string> ProblemCodeAsync(HttpResponseMessage response)
    {
        JsonElement problem = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        return problem.TryGetProperty("code", out JsonElement code) ? code.GetString() ?? string.Empty : string.Empty;
    }

    private static async Task<JsonElement> ErrorsAsync(HttpResponseMessage response)
    {
        JsonElement problem = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        return problem.GetProperty("errors");
    }

    // ---- token endpoint ---------------------------------------------------------------------------------------

    [Fact]
    public async Task The_form_token_is_public_not_cached_and_not_compressed()
    {
        using ContactHarness h = Harness(null);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/contact/form-token");
        request.Headers.AcceptEncoding.ParseAdd("br, gzip");

        using HttpResponseMessage response = await h.Client.SendAsync(request, Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Empty(response.Content.Headers.ContentEncoding);
        Assert.DoesNotContain(response.Headers, x => x.Key == "Set-Cookie");
        JsonElement json = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.False(string.IsNullOrEmpty(json.GetProperty("token").GetString()));
        Assert.Equal(2, json.GetProperty("minFillSeconds").GetInt32());
    }

    [Fact]
    public async Task Tokens_are_different_each_time()
    {
        using ContactHarness h = Harness(null);

        HashSet<string> tokens = [];
        for (int i = 0; i < 5; i++)
        {
            tokens.Add(await h.TokenAsync(wait: false));
        }

        Assert.Equal(5, tokens.Count);
    }

    // ---- storing and forwarding ---------------------------------------------------------------------------------

    [Fact]
    public async Task A_message_is_stored_answered_202_and_forwarded_by_mail_over_starttls()
    {
        using ContactHarness h = Harness();
        string marker = ContactHarness.Marker();

        using HttpResponseMessage response = await h.SubmitAsync($"Hello {marker}\r\nsecond line", "personal-data", "visitor@visitor.example");

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Empty(await response.Content.ReadAsByteArrayAsync(Ct));

        ContactMessage row = await h.WaitForRowAsync(marker, m => m.Status == ContactStatus.Sent);
        Assert.Equal(ContactTopic.PersonalData, row.Topic);
        Assert.Equal($"Hello {marker}\nsecond line", row.Message);
        Assert.Equal("visitor@visitor.example", row.ReplyTo);
        Assert.Equal(1, row.Attempts);
        Assert.NotNull(row.SentAt);
        Assert.Null(row.NextAttemptAt);
        Assert.Null(row.LastError);

        SmtpReceived received = await h.Smtp!.WaitForMessageAsync();
        Assert.Contains(ContactHarness.From, received.MailFrom, StringComparison.Ordinal);
        Assert.Contains(ContactHarness.ForwardTo, Assert.Single(received.RcptTo), StringComparison.Ordinal);
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(received.Raw));
        MimeMessage mail = await MimeMessage.LoadAsync(stream, Ct);
        Assert.Equal(ContactHarness.From, Assert.Single(mail.From.Mailboxes).Address);
        Assert.Equal(ContactHarness.ForwardTo, Assert.Single(mail.To.Mailboxes).Address);
        Assert.Equal("visitor@visitor.example", Assert.Single(mail.ReplyTo.Mailboxes).Address);
        Assert.StartsWith("[Polymnia] Personal data request (", mail.Subject, StringComparison.Ordinal);
        Assert.Contains(marker, mail.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Tls_is_negotiated_before_the_password_or_any_mail_is_sent()
    {
        using ContactHarness h = Harness();
        string marker = ContactHarness.Marker();

        using HttpResponseMessage response = await h.SubmitAsync(marker);
        await h.WaitForRowAsync(marker, m => m.Status == ContactStatus.Sent);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        IReadOnlyList<SmtpCommand> commands = h.Smtp!.Commands;
        int startTls = commands.ToList().FindIndex(c => c.Line.Equals("STARTTLS", StringComparison.OrdinalIgnoreCase));
        Assert.True(startTls >= 0, "STARTTLS was never sent.");
        foreach (SmtpCommand command in commands.Where(c =>
            c.Line.StartsWith("AUTH", StringComparison.OrdinalIgnoreCase)
            || c.Line.StartsWith("MAIL", StringComparison.OrdinalIgnoreCase)
            || c.Line.StartsWith("RCPT", StringComparison.OrdinalIgnoreCase)
            || c.Line.StartsWith("DATA", StringComparison.OrdinalIgnoreCase)))
        {
            Assert.True(command.Tls, $"'{command.Line[..Math.Min(8, command.Line.Length)]}' was sent in clear.");
        }

        // Nothing readable in clear: the plain-text part of the conversation is only the greeting and STARTTLS.
        Assert.All(commands.Where(c => !c.Tls), c => Assert.Matches("^(EHLO|STARTTLS)", c.Line.ToUpperInvariant()));
    }

    [Fact]
    public async Task Implicit_tls_on_port_465_style_connections_works()
    {
        using ContactHarness h = Harness(FakeSmtpMode.Implicit);
        string marker = ContactHarness.Marker();

        using HttpResponseMessage response = await h.SubmitAsync(marker);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        await h.WaitForRowAsync(marker, m => m.Status == ContactStatus.Sent);
        Assert.All(h.Smtp!.Commands, c => Assert.True(c.Tls));
    }

    [Fact]
    public async Task A_server_that_does_not_offer_starttls_is_never_used_in_clear()
    {
        using ContactHarness h = Harness(FakeSmtpMode.NoTls);
        string marker = ContactHarness.Marker();

        using HttpResponseMessage response = await h.SubmitAsync(marker);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        ContactMessage row = await h.WaitForRowAsync(marker, m => m.LastError is not null);
        Assert.Equal(ContactStatus.Pending, row.Status);
        Assert.Equal(1, row.Attempts);
        Assert.NotNull(row.NextAttemptAt);
        Assert.Empty(h.Smtp!.Messages);
        Assert.DoesNotContain(h.Smtp.Commands, c => c.Line.StartsWith("AUTH", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(h.Smtp.Commands, c => c.Line.StartsWith("MAIL", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task The_request_does_not_wait_for_the_mail()
    {
        // An SMTP server that never answers: the POST still comes back at once, the message is stored and stays pending.
        using var silent = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        silent.Start();
        int port = ((IPEndPoint)silent.LocalEndpoint).Port;
        using ContactHarness h = Harness(null, new()
        {
            ["Contact:ForwardTo"] = ContactHarness.ForwardTo,
            ["Contact:From"] = ContactHarness.From,
            ["Contact:SmtpHost"] = "127.0.0.1",
            ["Contact:SmtpPort"] = port.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["Contact:SmtpTimeoutSeconds"] = "30",
        });
        string marker = ContactHarness.Marker();

        var watch = System.Diagnostics.Stopwatch.StartNew();
        using HttpResponseMessage response = await h.SubmitAsync(marker);
        watch.Stop();

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(5), $"The POST took {watch.Elapsed}.");
        ContactMessage row = Assert.Single(await h.RowsAsync(marker));
        Assert.Equal(ContactStatus.Pending, row.Status);
    }

    [Fact]
    public async Task A_failed_forward_is_retried_later_and_the_status_follows()
    {
        using ContactHarness h = Harness();
        h.Smtp!.FailNext(1);
        string marker = ContactHarness.Marker();

        using HttpResponseMessage response = await h.SubmitAsync(marker);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        ContactMessage failed = await h.WaitForRowAsync(marker, m => m.LastError is not null);
        Assert.Equal(ContactStatus.Pending, failed.Status);
        Assert.Equal(1, failed.Attempts);
        Assert.Contains("Smtp", failed.LastError, StringComparison.Ordinal);
        Assert.NotNull(failed.NextAttemptAt);
        // The backoff is in the future: the forwarder leaves it alone for now.
        Assert.True(failed.NextAttemptAt > h.Clock.GetUtcNow());
        Assert.Empty(h.Smtp.Messages);

        // Time passes (simulated in the row): the next pass sends it.
        await h.SqlAsync("UPDATE contact_messages SET next_attempt_at = now() - interval '1 minute' WHERE message LIKE {0}", "%" + marker + "%");
        h.App.Services.GetRequiredService<ContactQueueSignal>().Notify();

        ContactMessage sent = await h.WaitForRowAsync(marker, m => m.Status == ContactStatus.Sent);
        Assert.Equal(2, sent.Attempts);
        Assert.Null(sent.LastError);
        Assert.Single(h.Smtp.Messages);
    }

    [Fact]
    public async Task After_the_last_attempt_the_message_is_left_failed_in_the_database()
    {
        using ContactHarness h = Harness();
        h.Smtp!.FailAlways();
        string marker = ContactHarness.Marker();

        using HttpResponseMessage response = await h.SubmitAsync(marker);
        await h.WaitForRowAsync(marker, m => m.LastError is not null);
        await h.SqlAsync(
            "UPDATE contact_messages SET attempts = {0}, next_attempt_at = now() - interval '1 minute' WHERE message LIKE {1}",
            ContactStore.MaxAttempts - 1,
            "%" + marker + "%");
        h.App.Services.GetRequiredService<ContactQueueSignal>().Notify();

        ContactMessage row = await h.WaitForRowAsync(marker, m => m.Status == ContactStatus.Failed);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(ContactStore.MaxAttempts, row.Attempts);
        Assert.Null(row.NextAttemptAt);
        Assert.NotNull(row.LastError);
        Assert.Contains(marker, row.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_late_result_from_a_lost_claim_changes_nothing()
    {
        using ContactHarness h = Harness(null);
        string marker = ContactHarness.Marker();
        using IServiceScope scope = h.App.Services.CreateScope();
        ContactStore store = scope.ServiceProvider.GetRequiredService<ContactStore>();
        Guid id = await store.AddAsync(ContactTopic.Other, marker, null, forward: true, Ct);
        ContactMessage? claimed = await store.ClaimNextAsync(TimeSpan.FromMinutes(2), Ct);
        // Another claim cannot be taken while the first is held.
        Assert.Null(await store.ClaimNextAsync(TimeSpan.FromMinutes(2), Ct));

        Assert.Equal(id, claimed?.Id);
        Assert.True(await store.MarkSentAsync(id, claimed!.Attempts, Ct));
        // The slow worker that lost the claim reports a failure, or a second success: nothing changes.
        await store.MarkFailedAsync(id, claimed.Attempts, "SmtpCommandException", Ct);
        Assert.False(await store.MarkSentAsync(id, claimed.Attempts, Ct));
        ContactMessage row = Assert.Single(await h.RowsAsync(marker));
        Assert.Equal(ContactStatus.Sent, row.Status);
        Assert.Null(row.LastError);
    }

    [Fact]
    public async Task A_message_that_ran_out_of_attempts_without_a_recorded_failure_is_left_failed()
    {
        using ContactHarness h = Harness(null);
        string marker = ContactHarness.Marker();
        using IServiceScope scope = h.App.Services.CreateScope();
        ContactStore store = scope.ServiceProvider.GetRequiredService<ContactStore>();
        await store.AddAsync(ContactTopic.Other, marker, null, forward: true, Ct);
        await h.SqlAsync("UPDATE contact_messages SET attempts = {0} WHERE message LIKE {1}", ContactStore.MaxAttempts, "%" + marker + "%");

        ContactMessage? claimed = await store.ClaimNextAsync(TimeSpan.FromMinutes(2), Ct);

        Assert.True(claimed is null || !claimed.Message.Contains(marker, StringComparison.Ordinal));
        Assert.Equal(ContactStatus.Failed, Assert.Single(await h.RowsAsync(marker)).Status);
    }

    [Fact]
    public async Task Without_smtp_settings_messages_are_only_stored_and_the_start_logs_a_warning()
    {
        using ContactHarness h = Harness(null);
        string marker = ContactHarness.Marker();

        using HttpResponseMessage response = await h.SubmitAsync(marker);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        ContactMessage row = Assert.Single(await h.RowsAsync(marker));
        Assert.Equal(ContactStatus.Stored, row.Status);
        Assert.Null(row.NextAttemptAt);
        Assert.Contains(h.App.Logs.Entries, e => e.EventId.Id == 32 && e.Level == Microsoft.Extensions.Logging.LogLevel.Warning && e.Category == ContactLog.Category);
    }

    [Fact]
    public async Task With_smtp_settings_there_is_no_warning()
    {
        using ContactHarness h = Harness();
        using HttpResponseMessage response = await h.Client.GetAsync("/api/health", Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.DoesNotContain(h.App.Logs.Entries, e => e.EventId.Id == 32);
    }

    // ---- validation --------------------------------------------------------------------------------------------

    [Fact]
    public async Task A_signed_out_visitor_needs_no_antiforgery_cookie_the_form_token_is_enough()
    {
        using ContactHarness h = Harness(null);

        using HttpResponseMessage response = await h.SubmitAsync("hello " + ContactHarness.Marker());

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
    }

    [Fact]
    public async Task A_signed_in_user_can_write_too_without_the_antiforgery_header()
    {
        using ContactHarness h = Harness(null);
        using HttpClient signedIn = await ScoreTestClients.SignInAsync(h.App, sendToken: false);
        string marker = ContactHarness.Marker();

        string token = await h.TokenAsync(signedIn);
        using HttpResponseMessage response = await h.PostAsync(new { topic = "other", message = marker, token }, signedIn);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        // The message is anonymous: nothing in the row ties it to the account.
        ContactMessage row = Assert.Single(await h.RowsAsync(marker));
        Assert.DoesNotContain(
            typeof(ContactMessage).GetProperties().Select(p => p.Name),
            n => n.Contains("User", StringComparison.Ordinal) || n.Contains("Owner", StringComparison.Ordinal) || n.Contains("Ip", StringComparison.Ordinal));
        Assert.Equal(ContactTopic.Other, row.Topic);
    }

    [Fact]
    public async Task The_antiforgery_exemption_covers_the_contact_route_only()
    {
        using ContactHarness h = Harness(null);

        using var content = new StringContent("{}", Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await h.Client.PostAsync("/api/contact/anything", content, Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("antiforgery", await ProblemCodeAsync(response));
    }

    [Theory]
    [InlineData("nope")]
    [InlineData("Question")]
    [InlineData("")]
    [InlineData(null)]
    public async Task An_unknown_topic_is_refused(string? topic)
    {
        using ContactHarness h = Harness(null);
        string token = await h.TokenAsync();

        using HttpResponseMessage response = await h.PostAsync(new { topic, message = "hi", token });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await ErrorsAsync(response)).TryGetProperty("topic", out _));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   \n\t  ")]
    public async Task An_empty_message_is_refused(string? message)
    {
        using ContactHarness h = Harness(null);
        string token = await h.TokenAsync();

        using HttpResponseMessage response = await h.PostAsync(new { topic = "question", message, token });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("required", (await ErrorsAsync(response)).GetProperty("message")[0].GetString());
    }

    [Fact]
    public async Task The_message_limit_is_2000_characters_counted_after_trimming()
    {
        using ContactHarness h = Harness(null);

        using HttpResponseMessage exact = await h.SubmitAsync("  " + new string('a', ContactLimits.MaxMessageLength) + "  ");
        using HttpResponseMessage tooLong = await h.SubmitAsync(new string('b', ContactLimits.MaxMessageLength + 1));

        Assert.Equal(HttpStatusCode.Accepted, exact.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        Assert.Equal("too-long", (await ErrorsAsync(tooLong)).GetProperty("message")[0].GetString());
        Assert.DoesNotContain(await h.RowsAsync(), m => m.Message.StartsWith('b'));
    }

    [Theory]
    [InlineData("null\\u0000byte")]
    [InlineData("bell\\u0007")]
    [InlineData("escape\\u001b[2J")]
    [InlineData("lone \\ud800 surrogate")]
    [InlineData("separator \\u2028 text")]
    public async Task Control_characters_and_text_tricks_are_refused(string escapedJsonText)
    {
        using ContactHarness h = Harness(null);
        string token = await h.TokenAsync();
        string json = $"{{\"topic\":\"question\",\"message\":\"{escapedJsonText}\",\"token\":\"{token}\"}}";
        using var content = new StringContent(json, Encoding.UTF8, "application/json");

        using HttpResponseMessage response = await h.Client.PostAsync("/api/contact", content, Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        JsonElement errors = await ErrorsAsync(response);
        // A lone surrogate is refused by the JSON reader itself (body), the others by the text rules (message).
        Assert.True(errors.TryGetProperty("body", out _) || errors.GetProperty("message")[0].GetString() == "invalid-characters");
        Assert.Empty(await h.RowsAsync("lone"));
    }

    [Fact]
    public async Task Invisible_format_characters_are_dropped_before_the_message_is_stored()
    {
        using ContactHarness h = Harness(null);
        string marker = ContactHarness.Marker();
        string hidden = marker + (char)0x200B + "visible" + (char)0x202E + "text" + char.ConvertFromUtf32(0xE0041);

        using HttpResponseMessage response = await h.SubmitAsync(hidden);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(marker + "visibletext", Assert.Single(await h.RowsAsync(marker)).Message);
    }

    [Fact]
    public async Task A_message_made_only_of_invisible_characters_is_empty_and_refused()
    {
        using ContactHarness h = Harness(null);

        using HttpResponseMessage response = await h.SubmitAsync(((char)0x200B).ToString() + (char)0x2060);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("required", (await ErrorsAsync(response)).GetProperty("message")[0].GetString());
    }

    [Fact]
    public async Task A_flood_of_refusals_writes_one_aggregated_log_line_per_kind()
    {
        using ContactHarness h = Harness(null, new() { ["Contact:AddressPerHour"] = "3" });
        HttpClient client = h.ClientFor("10.6.6.6");

        // Three robots, then thirty requests over the address budget.
        for (int i = 0; i < 3; i++)
        {
            using HttpResponseMessage bot = await h.SubmitAsync("spam", website: "x", client: client);
            Assert.Equal(HttpStatusCode.Accepted, bot.StatusCode);
        }

        for (int i = 0; i < 30; i++)
        {
            using HttpResponseMessage limited = await h.PostAsync(new { topic = "question", message = "x", token = "t" }, client);
            Assert.Equal((HttpStatusCode)429, limited.StatusCode);
        }

        Assert.Single(h.App.Logs.Entries, e => e.EventId.Id == 31);
        Assert.Single(h.App.Logs.Entries, e => e.EventId.Id == 38);
    }

    [Fact]
    public async Task The_smtp_password_comes_from_the_file_first_and_never_reaches_a_response_or_a_log()
    {
        string file = Path.GetTempFileName();
        try
        {
            await File.WriteAllTextAsync(file, FakeSmtpServer.Password + "\n", Ct);
            // The variable holds a wrong password: the file must win for the login to succeed.
            using ContactHarness h = Harness(settings: new()
            {
                ["Contact:SmtpPassword"] = "wrong-password-from-the-variable",
                ["Contact:SmtpPasswordFile"] = file,
            });
            string marker = ContactHarness.Marker();

            using HttpResponseMessage response = await h.SubmitAsync(marker);

            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
            await h.WaitForRowAsync(marker, m => m.Status == ContactStatus.Sent);
            string logs = string.Join('\n', h.App.Logs.Entries.Select(e => e.Message + e.Scopes));
            Assert.DoesNotContain(FakeSmtpServer.Password, logs, StringComparison.Ordinal);
            Assert.DoesNotContain("wrong-password-from-the-variable", logs, StringComparison.Ordinal);
        }
        finally
        {
            File.Delete(file);
        }
    }

    [Fact]
    public async Task Newlines_and_tabs_are_kept()
    {
        using ContactHarness h = Harness(null);
        string marker = ContactHarness.Marker();

        using HttpResponseMessage response = await h.SubmitAsync($"{marker}\r\n\tindented\n\nend");

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal($"{marker}\n\tindented\n\nend", Assert.Single(await h.RowsAsync(marker)).Message);
    }

    [Theory]
    [InlineData("not an address")]
    [InlineData("a@example.com, b@example.com")]
    [InlineData("Name <a@example.com>")]
    [InlineData("a@example.com\r\nBcc: evil@example.com")]
    [InlineData("a@example.com\nSubject: forged")]
    [InlineData("a@b")]
    public async Task A_reply_address_that_is_not_one_plain_address_is_refused(string replyTo)
    {
        using ContactHarness h = Harness();

        using HttpResponseMessage response = await h.SubmitAsync("hi " + ContactHarness.Marker(), replyTo: replyTo);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid", (await ErrorsAsync(response)).GetProperty("replyTo")[0].GetString());
        Assert.Empty(h.Smtp!.Messages);
    }

    [Fact]
    public async Task The_reply_address_is_optional_and_blank_means_none()
    {
        using ContactHarness h = Harness(null);
        string marker = ContactHarness.Marker();

        using HttpResponseMessage response = await h.SubmitAsync(marker, replyTo: "   ");

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Null(Assert.Single(await h.RowsAsync(marker)).ReplyTo);
    }

    [Fact]
    public async Task A_visitor_cannot_choose_the_subject_or_the_recipient()
    {
        using ContactHarness h = Harness();
        string marker = ContactHarness.Marker();
        string token = await h.TokenAsync();

        using HttpResponseMessage response = await h.PostAsync(new
        {
            topic = "question",
            message = marker,
            token,
            subject = "Injected subject",
            to = "attacker@evil.example",
            from = "boss@forward.example",
            cc = "attacker@evil.example",
        });
        SmtpReceived received = await h.Smtp!.WaitForMessageAsync();

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.DoesNotContain("evil.example", received.Raw, StringComparison.Ordinal);
        Assert.DoesNotContain("Injected", received.Raw, StringComparison.Ordinal);
        Assert.DoesNotContain("boss@", received.Raw, StringComparison.Ordinal);
        Assert.Single(received.RcptTo);
    }

    [Fact]
    public async Task The_body_must_be_json_and_small()
    {
        using ContactHarness h = Harness(null);

        using var wrongType = new StringContent("topic=question", Encoding.UTF8, "application/x-www-form-urlencoded");
        using HttpResponseMessage unsupported = await h.Client.PostAsync("/api/contact", wrongType, Ct);
        // The guard against cross-site posts: a plain-text or form body (what a page can send without a preflight).
        using var plain = new StringContent("{\"topic\":\"question\"}", Encoding.UTF8, "text/plain");
        using HttpResponseMessage plainResponse = await h.Client.PostAsync("/api/contact", plain, Ct);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, plainResponse.StatusCode);
        using var broken = new StringContent("{not json", Encoding.UTF8, "application/json");
        using HttpResponseMessage invalid = await h.Client.PostAsync("/api/contact", broken, Ct);
        using var empty = new StringContent("null", Encoding.UTF8, "application/json");
        using HttpResponseMessage nothing = await h.Client.PostAsync("/api/contact", empty, Ct);
        using var huge = new StringContent("{\"message\":\"" + new string('x', ContactEndpoints.MaxBodyBytes) + "\"}", Encoding.UTF8, "application/json");
        using HttpResponseMessage tooBig = await h.Client.PostAsync("/api/contact", huge, Ct);

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, unsupported.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, nothing.StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, tooBig.StatusCode);
    }

    // ---- honeypot and token -------------------------------------------------------------------------------------

    [Fact]
    public async Task A_filled_honeypot_looks_like_a_success_but_nothing_is_stored_or_sent()
    {
        using ContactHarness h = Harness();
        string marker = ContactHarness.Marker();

        using HttpResponseMessage response = await h.SubmitAsync(marker, website: "https://spam.example");

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        await Task.Delay(500, Ct);
        Assert.Empty(await h.RowsAsync(marker));
        Assert.Empty(h.Smtp!.Messages);
        Assert.Contains(h.App.Logs.Entries, e => e.EventId.Id == 31);
    }

    [Fact]
    public async Task A_missing_forged_or_edited_token_is_refused()
    {
        using ContactHarness h = Harness(null);
        string good = await h.TokenAsync();
        char[] edited = good.ToCharArray();
        edited[edited.Length / 2] = edited[edited.Length / 2] == 'A' ? 'B' : 'A';

        string marker = ContactHarness.Marker();
        foreach (string? token in new string?[] { null, "", "garbage", new string('A', 60), new string(edited), new string('x', 5000) })
        {
            using HttpResponseMessage response = await h.PostAsync(new { topic = "question", message = marker, token });

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal(ContactEndpoints.TokenProblemCode, await ProblemCodeAsync(response));
        }

        Assert.Empty(await h.RowsAsync(marker));
    }

    [Fact]
    public async Task A_payload_protected_for_another_purpose_is_not_a_form_token()
    {
        using ContactHarness h = Harness(null);
        // Same Data Protection keys, well-formed payload (issue time, nonce), but made for another purpose: the
        // antiforgery and cookie payloads of the application must never be accepted here.
        byte[] payload = new byte[24];
        System.Buffers.Binary.BinaryPrimitives.WriteInt64BigEndian(payload, h.Clock.GetUtcNow().ToUnixTimeSeconds() - 10);
        var provider = h.App.Services.GetRequiredService<Microsoft.AspNetCore.DataProtection.IDataProtectionProvider>();
        string foreign = Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(provider.CreateProtector("Polymnia.Other.Purpose").Protect(payload));
        string own = Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(
            provider.CreateProtector("Polymnia.Contact.FormToken.v1").Protect(payload));

        using HttpResponseMessage refused = await h.PostAsync(new { topic = "question", message = "hi", token = foreign });
        using HttpResponseMessage accepted = await h.PostAsync(new { topic = "question", message = "hi " + ContactHarness.Marker(), token = own });

        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Equal(ContactEndpoints.TokenProblemCode, await ProblemCodeAsync(refused));
        // Control: the same payload under the right purpose is a valid token (so the refusal above is about the purpose).
        Assert.Equal(HttpStatusCode.Accepted, accepted.StatusCode);
    }

    [Fact]
    public async Task A_token_is_refused_before_the_minimum_filling_time()
    {
        using ContactHarness h = Harness(null);
        string token = await h.TokenAsync(wait: false);

        using HttpResponseMessage tooFast = await h.PostAsync(new { topic = "question", message = "hi", token });
        h.Clock.Advance(TimeSpan.FromSeconds(3));
        using HttpResponseMessage later = await h.PostAsync(new { topic = "question", message = "hi " + ContactHarness.Marker(), token });

        Assert.Equal(HttpStatusCode.BadRequest, tooFast.StatusCode);
        Assert.Equal(ContactEndpoints.TokenProblemCode, await ProblemCodeAsync(tooFast));
        Assert.Equal(HttpStatusCode.Accepted, later.StatusCode);
    }

    [Fact]
    public async Task A_token_expires()
    {
        using ContactHarness h = Harness(null);
        string token = await h.TokenAsync();

        h.Clock.Advance(TimeSpan.FromMinutes(59));
        using HttpResponseMessage valid = await h.PostAsync(new { topic = "question", message = "hi " + ContactHarness.Marker(), token });
        h.Clock.Advance(TimeSpan.FromMinutes(2));
        using HttpResponseMessage expired = await h.PostAsync(new { topic = "question", message = "hi", token });

        Assert.Equal(HttpStatusCode.Accepted, valid.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, expired.StatusCode);
        Assert.Equal(ContactEndpoints.TokenProblemCode, await ProblemCodeAsync(expired));
    }

    // ---- rate limits -------------------------------------------------------------------------------------------

    [Fact]
    public async Task Each_address_may_write_five_times_an_hour_then_gets_429_with_Retry_After()
    {
        using ContactHarness h = Harness(null, new() { ["Contact:AddressPerHour"] = "5" });
        HttpClient client = h.ClientFor("10.9.9.9");

        for (int i = 0; i < 5; i++)
        {
            using HttpResponseMessage ok = await h.SubmitAsync("hello " + ContactHarness.Marker(), client: client);
            Assert.Equal(HttpStatusCode.Accepted, ok.StatusCode);
        }

        using HttpResponseMessage limited = await h.SubmitAsync("hello", client: client);

        Assert.Equal((HttpStatusCode)429, limited.StatusCode);
        Assert.True(int.Parse(limited.Headers.GetValues("Retry-After").Single(), System.Globalization.CultureInfo.InvariantCulture) > 0);
        // Another address is not affected.
        using HttpResponseMessage other = await h.SubmitAsync("hello " + ContactHarness.Marker(), client: h.ClientFor("10.9.9.10"));
        Assert.Equal(HttpStatusCode.Accepted, other.StatusCode);
    }

    [Fact]
    public async Task All_addresses_together_share_a_global_budget()
    {
        using ContactHarness h = Harness(null, new() { ["Contact:AddressPerHour"] = "100", ["Contact:GlobalPerHour"] = "3" });

        for (int i = 0; i < 3; i++)
        {
            using HttpResponseMessage ok = await h.SubmitAsync("hello " + ContactHarness.Marker(), client: h.ClientFor(ContactHarness.RandomIp()));
            Assert.Equal(HttpStatusCode.Accepted, ok.StatusCode);
        }

        using HttpResponseMessage limited = await h.SubmitAsync("hello", client: h.ClientFor(ContactHarness.RandomIp()));

        Assert.Equal((HttpStatusCode)429, limited.StatusCode);
        Assert.True(limited.Headers.Contains("Retry-After"));
    }

    [Fact]
    public async Task A_honeypot_hit_and_a_refused_message_cost_budget_like_any_other()
    {
        using ContactHarness h = Harness(null, new() { ["Contact:AddressPerHour"] = "2" });
        HttpClient client = h.ClientFor("10.8.8.8");

        using HttpResponseMessage bot = await h.SubmitAsync("spam", website: "x", client: client);
        using HttpResponseMessage bad = await h.SubmitAsync("", client: client);
        using HttpResponseMessage third = await h.SubmitAsync("hello", client: client);

        Assert.Equal(HttpStatusCode.Accepted, bot.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal((HttpStatusCode)429, third.StatusCode);
    }

    [Fact]
    public async Task Form_tokens_are_limited_per_address_too()
    {
        using ContactHarness h = Harness(null, new() { ["Contact:TokensPerAddressPerHour"] = "3" });
        HttpClient client = h.ClientFor("10.7.7.7");

        for (int i = 0; i < 3; i++)
        {
            using HttpResponseMessage ok = await client.GetAsync("/api/contact/form-token", Ct);
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        }

        using HttpResponseMessage limited = await client.GetAsync("/api/contact/form-token", Ct);

        Assert.Equal((HttpStatusCode)429, limited.StatusCode);
        Assert.True(limited.Headers.Contains("Retry-After"));
        Assert.Equal("no-store", limited.Headers.CacheControl?.ToString());
    }

    // ---- nothing leaks -------------------------------------------------------------------------------------------

    [Fact]
    public async Task No_address_or_secret_is_in_any_response_or_log()
    {
        using ContactHarness h = Harness();
        string marker = ContactHarness.Marker();
        const string replyTo = "private.visitor@visitor.example";
        List<string> bodies = [];

        using HttpResponseMessage tokenResponse = await h.Client.GetAsync("/api/contact/form-token", Ct);
        bodies.Add(await tokenResponse.Content.ReadAsStringAsync(Ct));
        using HttpResponseMessage ok = await h.SubmitAsync("secret text " + marker, replyTo: replyTo);
        bodies.Add(await ok.Content.ReadAsStringAsync(Ct));
        using HttpResponseMessage invalid = await h.SubmitAsync("secret text " + marker, replyTo: "bad address " + replyTo);
        bodies.Add(await invalid.Content.ReadAsStringAsync(Ct));
        using HttpResponseMessage legal = await h.Client.GetAsync("/api/legal", Ct);
        bodies.Add(await legal.Content.ReadAsStringAsync(Ct));
        await h.WaitForRowAsync(marker, m => m.Status == ContactStatus.Sent);
        h.Smtp!.FailAlways();
        using HttpResponseMessage failing = await h.SubmitAsync("again " + marker + "-2", replyTo: replyTo);
        await h.WaitForRowAsync(marker + "-2", m => m.LastError is not null);
        string logs = string.Join('\n', h.App.Logs.Entries.Select(e => $"{e.Category} {e.Message} {e.Scopes}"));

        string[] secrets = [ContactHarness.ForwardTo, ContactHarness.From, FakeSmtpServer.Password, FakeSmtpServer.User, replyTo, marker, "secret text"];
        foreach (string text in bodies.Append(logs).Append(string.Join('\n', ok.Headers.Select(x => x.Key + string.Join(',', x.Value)))))
        {
            foreach (string secret in secrets)
            {
                Assert.DoesNotContain(secret, text, StringComparison.Ordinal);
            }
        }

        Assert.Contains(h.App.Logs.Entries, e => e.EventId.Id == 30);
        Assert.Contains(h.App.Logs.Entries, e => e.EventId.Id == 33);
        Assert.Contains(h.App.Logs.Entries, e => e.EventId.Id == 34);
    }

    [Fact]
    public async Task The_privacy_endpoint_exposes_the_retention_and_never_the_forward_address()
    {
        using ContactHarness h = Harness(settings: new() { ["Contact:RetentionDays"] = "45", ["Legal:Contact"] = "/#/contact" });

        using HttpResponseMessage response = await h.Client.GetAsync("/api/legal", Ct);

        string body = await response.Content.ReadAsStringAsync(Ct);
        JsonElement legal = JsonDocument.Parse(body).RootElement;
        Assert.Equal(45, legal.GetProperty("contactRetentionDays").GetInt32());
        Assert.Equal("/#/contact", legal.GetProperty("contact").GetString());
        Assert.Equal("page", legal.GetProperty("contactKind").GetString());
        Assert.True(legal.GetProperty("configured").GetBoolean());
        Assert.DoesNotContain(ContactHarness.ForwardTo, body, StringComparison.Ordinal);
    }

    // ---- retention ---------------------------------------------------------------------------------------------

    [Fact]
    public async Task The_purge_removes_messages_older_than_the_retention_whatever_their_status()
    {
        using ContactHarness h = Harness(null, new() { ["Contact:RetentionDays"] = "30" });
        string oldMarker = ContactHarness.Marker();
        string recentMarker = ContactHarness.Marker();
        using HttpResponseMessage first = await h.SubmitAsync(oldMarker);
        await h.SqlAsync("UPDATE contact_messages SET status = 'Failed' WHERE message LIKE {0}", "%" + oldMarker + "%");
        h.Clock.Advance(TimeSpan.FromDays(31));
        using HttpResponseMessage second = await h.SubmitAsync(recentMarker);

        int removed = await h.App.Services.GetRequiredService<ContactPurgeService>().RunOnceAsync(Ct);

        Assert.Equal(HttpStatusCode.Accepted, first.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, second.StatusCode);
        Assert.True(removed >= 1);
        Assert.Empty(await h.RowsAsync(oldMarker));
        Assert.Single(await h.RowsAsync(recentMarker));
    }

    [Fact]
    public async Task The_purge_keeps_everything_inside_the_retention()
    {
        using ContactHarness h = Harness(null, new() { ["Contact:RetentionDays"] = "30" });
        string marker = ContactHarness.Marker();
        using HttpResponseMessage response = await h.SubmitAsync(marker);
        h.Clock.Advance(TimeSpan.FromDays(29));

        await h.App.Services.GetRequiredService<ContactPurgeService>().RunOnceAsync(Ct);

        Assert.Single(await h.RowsAsync(marker));
    }

    [Fact]
    public void The_purge_and_the_forwarder_run_as_hosted_services()
    {
        using ContactHarness h = Harness(null);

        IEnumerable<Microsoft.Extensions.Hosting.IHostedService> hosted = h.App.Services.GetServices<Microsoft.Extensions.Hosting.IHostedService>();

        Assert.Contains(hosted, s => s is ContactPurgeService);
        Assert.Contains(hosted, s => s is ContactForwarder);
    }

    [Fact]
    public async Task A_database_failure_during_the_purge_is_logged_by_type_and_does_not_throw()
    {
        // A host whose database does not exist: the purge fails, says so without a message, and returns.
        using var app = new TestApp(settings: new() { ["Contact:RetentionDays"] = "30" });
        _ = app.CreateClient();

        int removed = await app.Services.GetRequiredService<ContactPurgeService>().RunOnceAsync(Ct);

        Assert.Equal(0, removed);
        Assert.Contains(app.Logs.Entries, e => e.EventId.Id == 37);
    }

    // ---- start-up ----------------------------------------------------------------------------------------------

    [Fact]
    public void A_partial_smtp_setup_stops_the_start_without_printing_a_value()
    {
        using var app = new TestApp(settings: new()
        {
            ["Contact:SmtpHost"] = "smtp.example",
            ["Contact:SmtpPassword"] = "super-secret-password",
        });

        Exception ex = Assert.ThrowsAny<Exception>(() => app.CreateClient());

        string text = ex.ToString();
        Assert.Contains("Contact:", text, StringComparison.Ordinal);
        Assert.DoesNotContain("super-secret-password", text, StringComparison.Ordinal);
        Assert.DoesNotContain("smtp.example", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Only_the_submit_route_is_exempt_from_the_antiforgery_header()
    {
        Assert.True(ContactEndpoints.IsSubmitPath("/api/contact"));
        Assert.True(ContactEndpoints.IsSubmitPath("/api/CONTACT/"));
        Assert.False(ContactEndpoints.IsSubmitPath("/api/contact/form-token"));
        Assert.False(ContactEndpoints.IsSubmitPath("/api/contacts"));
        Assert.False(ContactEndpoints.IsSubmitPath("/api/scores"));
    }
}
