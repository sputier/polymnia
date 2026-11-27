using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting.Internal;
using Microsoft.Extensions.Logging;
using Polymnia.Api.Auth;
using Polymnia.Api.Hosting;

namespace Polymnia.Tests;

/// <summary>Storage quota, registration brakes, database size alert and database password guard (decisions on #20).</summary>
public sealed class AbuseLimitsTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly string Small = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "score-small.json"));

    private async Task<TestApp> StartAsync(Dictionary<string, string?>? settings = null)
    {
        postgres.SkipIfUnavailable();
        var app = new TestApp(connectionString: postgres.ConnectionString, settings: settings);
        await app.MigrateAsync();
        return app;
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    // ---- storage quota ---------------------------------------------------------------------------------------

    private static readonly string Big = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "score-500-measures.json"));

    /// <summary>What the database stores for the small fixture (the unit of the quota).</summary>
    private async Task<long> StoredSizeOfSmallAsync()
    {
        using TestApp probe = await StartAsync();
        using HttpClient client = await ScoreTestClients.SignInAsync(probe);
        using HttpResponseMessage created = await client.PostAsync("/api/scores", Json(Small), Ct);
        Guid id = (await created.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("id").GetGuid();
        using IServiceScope scope = probe.Services.CreateScope();
        return (await scope.ServiceProvider.GetRequiredService<Polymnia.Infrastructure.PolymniaDbContext>().Database
            .SqlQuery<long>($"SELECT pg_column_size(content)::bigint AS \"Value\" FROM scores WHERE id = {id}")
            .ToListAsync(Ct))[0];
    }

    [Fact]
    public async Task The_storage_quota_refuses_what_would_exceed_it_with_a_typed_413_and_is_per_user()
    {
        long unit = await StoredSizeOfSmallAsync();
        using TestApp app = await StartAsync(new() { ["Scores:MaxStorageBytesPerUser"] = (unit * 5 / 2).ToString(System.Globalization.CultureInfo.InvariantCulture) });
        using HttpClient client = await ScoreTestClients.SignInAsync(app);

        // Exactly two copies fit.
        Guid first = Guid.Empty;
        for (int i = 0; i < 2; i++)
        {
            using HttpResponseMessage response = await client.PostAsync("/api/scores", Json(Small), Ct);
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            if (i == 0)
            {
                first = (await response.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("id").GetGuid();
            }
        }

        using HttpResponseMessage third = await client.PostAsync("/api/scores", Json(Small), Ct);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, third.StatusCode);
        Assert.Equal("urn:polymnia:problem:quota-exceeded", (await third.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("type").GetString());

        // Duplicating counts too, and another user is not affected.
        using HttpResponseMessage duplicate = await client.PostAsync($"/api/scores/{first}/duplicate", null, Ct);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, duplicate.StatusCode);
        using HttpClient other = await ScoreTestClients.SignInAsync(app);
        using HttpResponseMessage fresh = await other.PostAsync("/api/scores", Json(Small), Ct);
        Assert.Equal(HttpStatusCode.Created, fresh.StatusCode);

        // Deleting frees room.
        using HttpResponseMessage delete = await client.DeleteAsync($"/api/scores/{first}", Ct);
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        using HttpResponseMessage again = await client.PostAsync("/api/scores", Json(Small), Ct);
        Assert.Equal(HttpStatusCode.Created, again.StatusCode);
    }

    [Fact]
    public async Task Saves_that_grow_past_the_quota_are_refused_but_404_and_409_come_first_and_shrinking_is_allowed()
    {
        long unit = await StoredSizeOfSmallAsync();
        using TestApp app = await StartAsync(new() { ["Scores:MaxStorageBytesPerUser"] = (unit * 3).ToString(System.Globalization.CultureInfo.InvariantCulture) });
        using HttpClient client = await ScoreTestClients.SignInAsync(app);
        using HttpResponseMessage created = await client.PostAsync("/api/scores", Json(Small), Ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Guid id = (await created.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("id").GetGuid();
        string etag = created.Headers.ETag!.Tag;

        HttpRequestMessage Put(Guid target, string body, string ifMatch)
        {
            var request = new HttpRequestMessage(HttpMethod.Put, $"/api/scores/{target}") { Content = Json(body) };
            request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
            return request;
        }

        using HttpResponseMessage refused = await client.SendAsync(Put(id, Big, etag), Ct);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, refused.StatusCode);
        Assert.Equal("urn:polymnia:problem:quota-exceeded", (await refused.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("type").GetString());

        // Not a quota answer: a stale version is a conflict, an unknown score is not found.
        using HttpResponseMessage stale = await client.SendAsync(Put(id, Big, "\"99\""), Ct);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        using HttpResponseMessage missing = await client.SendAsync(Put(Guid.NewGuid(), Big, etag), Ct);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);

        // The refused save changed nothing: the same version still saves a document that fits.
        using HttpResponseMessage fits = await client.SendAsync(Put(id, Small, etag), Ct);
        Assert.Equal(HttpStatusCode.OK, fits.StatusCode);

        // A patch (rename of a part is not needed: a no-growth edit of the title) is still accepted below the limit.
        using HttpRequestMessage rename = new(HttpMethod.Patch, $"/api/scores/{id}") { Content = JsonContent.Create(new { title = "Renamed" }) };
        rename.Headers.TryAddWithoutValidation("If-Match", fits.Headers.ETag!.Tag);
        using HttpResponseMessage renamed = await client.SendAsync(rename, Ct);
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
    }

    [Fact]
    public async Task Parallel_creations_cannot_overshoot_the_quota()
    {
        long unit = await StoredSizeOfSmallAsync();
        using TestApp app = await StartAsync(new() { ["Scores:MaxStorageBytesPerUser"] = (unit * 3 / 2).ToString(System.Globalization.CultureInfo.InvariantCulture) });
        using HttpClient client = await ScoreTestClients.SignInAsync(app);

        HttpStatusCode[] results = await Task.WhenAll(Enumerable.Range(0, 2).Select(async _ =>
        {
            using HttpResponseMessage response = await client.PostAsync("/api/scores", Json(Small), Ct);
            return response.StatusCode;
        }));
        // Writes are limited to two at a time per user: only what fits was stored.
        using HttpResponseMessage list = await client.GetAsync("/api/scores", Ct);
        int stored = (await list.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("total").GetInt32();
        Assert.Equal(results.Count(r => r == HttpStatusCode.Created), stored);
        Assert.Equal(1, stored);
        Assert.Contains(HttpStatusCode.RequestEntityTooLarge, results);
    }


    // ---- registration brakes ---------------------------------------------------------------------------------

    private static async Task<HttpResponseMessage> SignInAsync(TestApp app, TestBrowser browser, string subject, string ip)
    {
        app.Google.Subject = subject;
        using HttpResponseMessage login = await browser.SendAsync(HttpMethod.Get, "/api/auth/login", clientIp: ip);
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        return await browser.SendAsync(HttpMethod.Get, login.Headers.Location!.OriginalString, clientIp: ip);
    }

    [Fact]
    public async Task New_accounts_per_address_are_limited_and_existing_users_still_sign_in()
    {
        using TestApp app = await StartAsync(new() { ["Auth:Registration:MaxNewAccountsPerAddressPerDay"] = "2" });
        string a = "sub-" + Guid.NewGuid().ToString("N");

        var browserA = new TestBrowser(app);
        using (await SignInAsync(app, browserA, a, "10.20.30.40"))
        {
            Assert.NotNull(browserA.SessionCookie);
        }

        var browserB = new TestBrowser(app);
        using (await SignInAsync(app, browserB, "sub-" + Guid.NewGuid().ToString("N"), "10.20.30.40"))
        {
            Assert.NotNull(browserB.SessionCookie);
        }

        var browserC = new TestBrowser(app);
        using HttpResponseMessage closed = await SignInAsync(app, browserC, "sub-" + Guid.NewGuid().ToString("N"), "10.20.30.40");
        Assert.Equal(HttpStatusCode.Redirect, closed.StatusCode);
        Assert.Equal("/?signin=closed", closed.Headers.Location!.OriginalString);
        Assert.Null(browserC.SessionCookie);
        Assert.Contains(app.Logs.Entries, e => e.EventId.Name == "AuthRegistrationClosed");

        // The same address, an existing user: not a registration.
        var again = new TestBrowser(app);
        using HttpResponseMessage existing = await SignInAsync(app, again, a, "10.20.30.40");
        Assert.NotEqual("/?signin=closed", existing.Headers.Location!.OriginalString);
        Assert.NotNull(again.SessionCookie);

        // Another address is not affected.
        var elsewhere = new TestBrowser(app);
        using (await SignInAsync(app, elsewhere, "sub-" + Guid.NewGuid().ToString("N"), "10.99.1.1"))
        {
            Assert.NotNull(elsewhere.SessionCookie);
        }
    }

    [Fact]
    public async Task New_accounts_per_day_are_limited_for_the_whole_instance()
    {
        using TestApp app = await StartAsync(new() { ["Auth:Registration:MaxNewAccountsPerDay"] = "1" });
        using (IServiceScope scope = app.Services.CreateScope())
        {
            // The database is shared by the tests of this class: start from no account at all.
            await scope.ServiceProvider.GetRequiredService<Polymnia.Infrastructure.PolymniaDbContext>().Database.ExecuteSqlRawAsync("DELETE FROM users; DELETE FROM registration_events", Ct);
        }

        string first = "sub-" + Guid.NewGuid().ToString("N");

        var browser = new TestBrowser(app);
        using (await SignInAsync(app, browser, first, "10.1.1.1"))
        {
            Assert.NotNull(browser.SessionCookie);
        }

        var late = new TestBrowser(app);
        using HttpResponseMessage closed = await SignInAsync(app, late, "sub-" + Guid.NewGuid().ToString("N"), "10.2.2.2");
        Assert.Equal("/?signin=closed", closed.Headers.Location!.OriginalString);
        Assert.Null(late.SessionCookie);

        var existing = new TestBrowser(app);
        using (await SignInAsync(app, existing, first, "10.3.3.3"))
        {
            Assert.NotNull(existing.SessionCookie);
        }
    }

    private static async Task ResetRegistrationsAsync(TestApp app)
    {
        using IServiceScope scope = app.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<Polymnia.Infrastructure.PolymniaDbContext>().Database
            .ExecuteSqlRawAsync("DELETE FROM users; DELETE FROM registration_events", Ct);
    }

    [Fact]
    public async Task Creating_and_deleting_accounts_does_not_reset_the_daily_cap()
    {
        using TestApp app = await StartAsync(new() { ["Auth:Registration:MaxNewAccountsPerDay"] = "1" });
        await ResetRegistrationsAsync(app);
        string first = "sub-" + Guid.NewGuid().ToString("N");
        var browser = new TestBrowser(app);
        using (await SignInAsync(app, browser, first, "10.1.1.1"))
        {
            Assert.NotNull(browser.SessionCookie);
        }

        // The account is deleted (as the user's own deletion does): the registration stays counted, and holds no personal data.
        using (IServiceScope scope = app.Services.CreateScope())
        {
            Polymnia.Infrastructure.PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<Polymnia.Infrastructure.PolymniaDbContext>();
            Assert.Equal(1, await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM users WHERE google_subject = {first}", Ct));
            Assert.Equal(1, await db.RegistrationEvents.CountAsync(Ct));
        }

        var late = new TestBrowser(app);
        using HttpResponseMessage closed = await SignInAsync(app, late, "sub-" + Guid.NewGuid().ToString("N"), "10.2.2.2");
        Assert.Equal("/?signin=closed", closed.Headers.Location!.OriginalString);
        Assert.Null(late.SessionCookie);
    }

    [Fact]
    public async Task Simultaneous_first_sign_ins_one_below_the_cap_let_exactly_one_through()
    {
        using TestApp app = await StartAsync();
        await ResetRegistrationsAsync(app);
        const int cap = 3;

        async Task<Guid?> TrySignInAsync()
        {
            using IServiceScope scope = app.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<Polymnia.Infrastructure.Users.UserProvisioner>()
                .SignInAsync("sub-" + Guid.NewGuid().ToString("N"), "Someone", null, cap, Ct);
        }

        for (int i = 0; i < cap - 1; i++)
        {
            Assert.NotNull(await TrySignInAsync());
        }

        Guid?[] results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => TrySignInAsync()));

        Assert.Equal(1, results.Count(r => r is not null));
        using IServiceScope check = app.Services.CreateScope();
        Assert.Equal(cap, await check.ServiceProvider.GetRequiredService<Polymnia.Infrastructure.PolymniaDbContext>().RegistrationEvents.CountAsync(Ct));
    }

    [Fact]
    public async Task Two_simultaneous_first_sign_ins_of_the_same_person_on_the_last_place_both_succeed()
    {
        using TestApp app = await StartAsync();
        await ResetRegistrationsAsync(app);
        string subject = "sub-" + Guid.NewGuid().ToString("N");

        async Task<Guid?> TrySignInAsync()
        {
            using IServiceScope scope = app.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<Polymnia.Infrastructure.Users.UserProvisioner>()
                .SignInAsync(subject, "Someone", null, 1, Ct);
        }

        Guid?[] results = await Task.WhenAll(TrySignInAsync(), TrySignInAsync(), TrySignInAsync());

        Assert.All(results, r => Assert.NotNull(r));
        Assert.Single(results.Distinct());
    }

    // ---- database size alert ---------------------------------------------------------------------------------

    [Fact]
    public async Task The_database_size_alert_warns_above_the_threshold_and_stays_quiet_below_it()
    {
        using TestApp app = await StartAsync(new() { ["Monitoring:DatabaseSizeWarningBytes"] = "1" });
        DatabaseSizeMonitor monitor = app.Services.GetRequiredService<DatabaseSizeMonitor>();
        app.Logs.Clear();

        long? size = await monitor.CheckAsync(Ct);

        Assert.True(size > 1);
        LogCapture.LogEntry warning = Assert.Single(app.Logs.Entries, e => e.EventId.Name == "DatabaseSizeExceeded");
        Assert.Equal(LogLevel.Warning, warning.Level);
        Assert.Contains("Monitoring:DatabaseSizeWarningBytes", warning.Message, StringComparison.Ordinal);

        using TestApp quiet = await StartAsync(new() { ["Monitoring:DatabaseSizeWarningBytes"] = "1099511627776" });
        quiet.Logs.Clear();
        Assert.NotNull(await quiet.Services.GetRequiredService<DatabaseSizeMonitor>().CheckAsync(Ct));
        Assert.DoesNotContain(quiet.Logs.Entries, e => e.EventId.Name == "DatabaseSizeExceeded");

        using TestApp off = await StartAsync(new() { ["Monitoring:DatabaseSizeWarningBytes"] = "0" });
        Assert.Null(await off.Services.GetRequiredService<DatabaseSizeMonitor>().CheckAsync(Ct));
    }
}

/// <summary>The database password guard (no Docker needed).</summary>
public sealed class ConnectionStringGuardTests
{
    private static IConfiguration Config(string connectionString) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:Polymnia"] = connectionString }).Build();

    private static HostingEnvironment Env(string name) => new() { EnvironmentName = name };

    [Theory]
    [InlineData("Host=db;Database=p;Username=u;Password=change-me-locally")]
    [InlineData("Host=db;Database=p;Username=u;Password=Change-Me-Locally-0000000000")]
    [InlineData("Host=db;Database=p;Username=u;Password=short")]
    [InlineData("Host=db;Database=p;Username=u;Password=123456789012345")]
    [InlineData("Host=db;Database=p;Username=u")]
    public void Outside_development_a_placeholder_short_or_missing_password_stops_the_start(string connectionString)
    {
        InvalidOperationException ex = Assert.Throws<InvalidOperationException>(
            () => ConnectionStringGuard.Validate(Config(connectionString), Env("Production")));

        Assert.DoesNotContain("change-me-locally", ex.Message.Replace("placeholder of .env.example", string.Empty, StringComparison.Ordinal), StringComparison.Ordinal);
        Assert.DoesNotContain("Host=db", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void A_long_random_password_is_accepted_and_development_is_exempt()
    {
        ConnectionStringGuard.Validate(Config("Host=db;Database=p;Username=u;Password=0123456789abcdef"), Env("Production"));
        ConnectionStringGuard.Validate(Config("Host=localhost;Database=p;Username=u;Password=dev"), Env("Development"));
    }

    [Fact]
    public void The_application_refuses_to_start_with_the_placeholder_password()
    {
        using var app = new TestApp(connectionString: "Host=127.0.0.1;Port=1;Database=x;Username=u;Password=change-me-locally;Timeout=1");

        Assert.Throws<InvalidOperationException>(() => app.CreateClient());
    }
}
