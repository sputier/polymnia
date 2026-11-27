using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using Polymnia.Api.Account;
using Polymnia.Api.Auth;
using Polymnia.Core.Scores;
using Polymnia.Infrastructure;

namespace Polymnia.Tests;

/// <summary>Account deletion and data export (GDPR, docs/privacy.md) against a real PostgreSQL.</summary>
public sealed class AccountPrivacyTests(ScoreApiFixture fixture) : IClassFixture<ScoreApiFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly string Small = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "score-small.json"));
    private static readonly string Big = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "score-500-measures.json"));

    private TestApp App
    {
        get
        {
            fixture.Postgres.SkipIfUnavailable();
            return fixture.App;
        }
    }

    private static StringContent Json(string body) => new(body, Encoding.UTF8, "application/json");

    private static async Task<Guid> MeAsync(HttpClient client)
    {
        using HttpResponseMessage me = await client.GetAsync("/api/me", Ct);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        return (await me.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("id").GetGuid();
    }

    private static async Task CreateScoresAsync(HttpClient client, int count)
    {
        for (int i = 0; i < count; i++)
        {
            using HttpResponseMessage created = await client.PostAsync("/api/scores", Json(Small), Ct);
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        }
    }

    private async Task<long> CountAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(fixture.Postgres.ConnectionString);
        await connection.OpenAsync(Ct);
        await using var command = new NpgsqlCommand(sql, connection);
        foreach ((string name, object value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        return (long)(await command.ExecuteScalarAsync(Ct))!;
    }

    // ---- deletion -------------------------------------------------------------------------------------------

    [Fact]
    public async Task Deleting_the_account_removes_every_row_of_the_user_and_nothing_of_the_others()
    {
        TestApp app = App;
        HttpClient ada = await ScoreTestClients.SignInAsync(app);
        HttpClient bob = await ScoreTestClients.SignInAsync(app);
        Guid adaId = await MeAsync(ada);
        Guid bobId = await MeAsync(bob);
        await CreateScoresAsync(ada, 3);
        await CreateScoresAsync(bob, 2);
        app.Logs.Clear();

        using HttpResponseMessage deleted = await ada.DeleteAsync("/api/me", Ct);

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        string[] cookies = deleted.Headers.GetValues("Set-Cookie").ToArray();
        Assert.Contains(cookies, c => c.StartsWith(AuthDefaults.SessionCookieName + "=;", StringComparison.Ordinal));
        Assert.Contains(cookies, c => c.StartsWith(AuthDefaults.RequestTokenCookieName + "=;", StringComparison.Ordinal));

        // Every table that references the user is empty for them (discovered from the catalog, so a table added
        // later is covered too), and the user row itself is gone.
        Assert.Equal(0L, await CountAsync("SELECT count(*) FROM users WHERE id = @id", ("id", adaId)));
        foreach ((string table, string column) in await ReferencingColumnsAsync())
        {
            Assert.Equal(0L, await CountAsync($"SELECT count(*) FROM \"{table}\" WHERE \"{column}\" = @id", ("id", adaId)));
        }

        // The other user is untouched.
        Assert.Equal(1L, await CountAsync("SELECT count(*) FROM users WHERE id = @id", ("id", bobId)));
        Assert.Equal(2L, await CountAsync("SELECT count(*) FROM scores WHERE owner_id = @id", ("id", bobId)));
        Assert.True(await CountAsync("SELECT count(*) FROM user_sessions WHERE user_id = @id", ("id", bobId)) >= 1);
        using HttpResponseMessage bobMe = await bob.GetAsync("/api/me", Ct);
        Assert.Equal(HttpStatusCode.OK, bobMe.StatusCode);

        // The old cookie is useless now.
        using HttpResponseMessage adaMe = await ada.GetAsync("/api/me", Ct);
        Assert.Equal(HttpStatusCode.Unauthorized, adaMe.StatusCode);

        // Audit: one event, the user id only.
        LogCapture.LogEntry audit = Assert.Single(app.Logs.Entries, e => e.EventId.Name == "AuthAccountDeleted");
        Assert.Equal(LogLevel.Information, audit.Level);
        Assert.Contains(adaId.ToString(), audit.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("Ada Lovelace", audit.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Every_foreign_key_to_users_cascades_on_delete()
    {
        _ = App;
        // A table added later (share links, ...) that forgets ON DELETE CASCADE would make erasure fail or leave data.
        await using var connection = new NpgsqlConnection(fixture.Postgres.ConnectionString);
        await connection.OpenAsync(Ct);
        await using var command = new NpgsqlCommand(
            "SELECT conrelid::regclass::text FROM pg_constraint WHERE contype = 'f' AND confrelid = 'users'::regclass AND confdeltype <> 'c'",
            connection);
        await using NpgsqlDataReader reader = await command.ExecuteReaderAsync(Ct);
        List<string> offenders = [];
        while (await reader.ReadAsync(Ct))
        {
            offenders.Add(reader.GetString(0));
        }

        Assert.Empty(offenders);
    }

    private async Task<List<(string Table, string Column)>> ReferencingColumnsAsync()
    {
        await using var connection = new NpgsqlConnection(fixture.Postgres.ConnectionString);
        await connection.OpenAsync(Ct);
        await using var command = new NpgsqlCommand(
            """
            SELECT c.conrelid::regclass::text, a.attname
            FROM pg_constraint c
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
            WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass
            """,
            connection);
        await using NpgsqlDataReader reader = await command.ExecuteReaderAsync(Ct);
        List<(string, string)> result = [];
        while (await reader.ReadAsync(Ct))
        {
            result.Add((reader.GetString(0).Trim('"'), reader.GetString(1)));
        }

        Assert.NotEmpty(result);
        return result;
    }

    [Fact]
    public async Task Deleting_the_account_without_the_antiforgery_header_is_refused_and_deletes_nothing()
    {
        TestApp app = App;
        HttpClient client = await ScoreTestClients.SignInAsync(app, sendToken: false);
        Guid id = await MeAsync(client);

        using HttpResponseMessage response = await client.DeleteAsync("/api/me", Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("\"code\":\"antiforgery\"", await response.Content.ReadAsStringAsync(Ct), StringComparison.Ordinal);
        Assert.Equal(1L, await CountAsync("SELECT count(*) FROM users WHERE id = @id", ("id", id)));
    }

    [Fact]
    public async Task Deleting_the_account_anonymously_is_401()
    {
        var browser = new TestBrowser(App);
        string token = await browser.FetchAntiforgeryTokenAsync();

        using HttpResponseMessage response = await browser.SendAsync(HttpMethod.Delete, "/api/me", xsrfHeader: token);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task An_old_sign_in_must_sign_in_again_before_deleting_and_then_can()
    {
        fixture.Postgres.SkipIfUnavailable();
        // A 5 second window instead of 10 minutes keeps the test short.
        using var app = new TestApp(
            connectionString: fixture.Postgres.ConnectionString,
            settings: new() { ["Auth:RecentSignInWindow"] = "00:00:05" });
        app.Google.Subject = "sub-" + Guid.NewGuid().ToString("N");
        var browser = new TestBrowser(app);
        using (await browser.SignInAsync())
        {
        }

        string token = await browser.FetchAntiforgeryTokenAsync();
        using HttpResponseMessage me = await browser.GetAsync("/api/me");
        Guid id = (await me.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("id").GetGuid();

        // Fresh session: the deletion goes through only after the window, so first prove the window itself works.
        await Task.Delay(TimeSpan.FromSeconds(5.5), Ct);
        app.Logs.Clear();
        using HttpResponseMessage refused = await browser.SendAsync(HttpMethod.Delete, "/api/me", xsrfHeader: token);

        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Contains($"\"code\":\"{AccountEndpoints.ReauthProblemCode}\"", await refused.Content.ReadAsStringAsync(Ct), StringComparison.Ordinal);
        Assert.Equal(1L, await CountAsync("SELECT count(*) FROM users WHERE id = @id", ("id", id)));
        Assert.Contains(app.Logs.Entries, e => e.EventId.Name == "AuthReauthRequired");

        // A signed-in user is normally sent straight back by /login; with reauth=true they go to Google again.
        using HttpResponseMessage plain = await browser.GetAsync("/api/auth/login");
        Assert.Equal("/", plain.Headers.Location!.OriginalString);
        using HttpResponseMessage reauth = await browser.GetAsync("/api/auth/login?reauth=true&returnUrl=/");
        Assert.StartsWith("/api/auth/callback", reauth.Headers.Location!.OriginalString, StringComparison.Ordinal);
        using (await browser.GetAsync(reauth.Headers.Location!.OriginalString))
        {
        }

        string fresh = await browser.FetchAntiforgeryTokenAsync();
        using HttpResponseMessage deleted = await browser.SendAsync(HttpMethod.Delete, "/api/me", xsrfHeader: fresh);

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Equal(0L, await CountAsync("SELECT count(*) FROM users WHERE id = @id", ("id", id)));
        Assert.Equal(0L, await CountAsync("SELECT count(*) FROM user_sessions WHERE user_id = @id", ("id", id)));
    }

    [Fact]
    public async Task Signing_in_again_with_a_different_google_account_is_refused_and_creates_no_user()
    {
        TestApp app = App;
        app.Google.Subject = "sub-" + Guid.NewGuid().ToString("N");
        var browser = new TestBrowser(app);
        using (await browser.SignInAsync())
        {
        }

        using HttpResponseMessage reauth = await browser.GetAsync("/api/auth/login?reauth=true");
        string other = "sub-other-" + Guid.NewGuid().ToString("N");
        app.Google.Subject = other;
        using HttpResponseMessage callback = await browser.GetAsync(reauth.Headers.Location!.OriginalString);

        Assert.Equal(0L, await CountAsync("SELECT count(*) FROM users WHERE google_subject = @s", ("s", other)));
        // No session of the other account was issued.
        using HttpResponseMessage me = await browser.GetAsync("/api/me");
        Assert.NotEqual(HttpStatusCode.OK, me.StatusCode);
        Assert.Equal(0L, await CountAsync("SELECT count(*) FROM users WHERE google_subject = @s", ("s", other)));
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("abc", false)]
    [InlineData("-5", false)]
    public void A_session_without_a_valid_sign_in_time_is_not_recent(string? claim, bool expected)
    {
        var identity = new System.Security.Claims.ClaimsIdentity(claim is null ? [] : [new System.Security.Claims.Claim(AuthDefaults.AuthTimeClaim, claim)], "test");

        Assert.Equal(expected, AccountEndpoints.SignedInRecently(new System.Security.Claims.ClaimsPrincipal(identity), TimeProvider.System, TimeSpan.FromMinutes(10)));
    }

    [Fact]
    public void Only_a_sign_in_inside_the_window_is_recent()
    {
        DateTimeOffset now = DateTimeOffset.UtcNow;
        bool Recent(TimeSpan age, TimeSpan window) => AccountEndpoints.SignedInRecently(
            new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(
                [new System.Security.Claims.Claim(AuthDefaults.AuthTimeClaim, (now - age).ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture))], "test")),
            TimeProvider.System,
            window);

        Assert.True(Recent(TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(10)));
        Assert.False(Recent(TimeSpan.FromMinutes(11), TimeSpan.FromMinutes(10)));
        Assert.False(Recent(TimeSpan.FromDays(-1), TimeSpan.FromMinutes(10))); // from the future
    }

    // ---- export ---------------------------------------------------------------------------------------------

    private static async Task<Dictionary<string, byte[]>> ReadZipAsync(HttpResponseMessage response)
    {
        await using Stream body = await response.Content.ReadAsStreamAsync(Ct);
        using var zip = new ZipArchive(body, ZipArchiveMode.Read);
        Dictionary<string, byte[]> files = [];
        foreach (ZipArchiveEntry entry in zip.Entries)
        {
            await using Stream stream = await entry.OpenAsync(Ct);
            using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer, Ct);
            files[entry.FullName] = buffer.ToArray();
        }

        return files;
    }

    [Fact]
    public async Task Export_contains_exactly_the_users_data_and_no_credential()
    {
        TestApp app = App;
        HttpClient ada = await ScoreTestClients.SignInAsync(app);
        string adaSubject = app.Google.Subject;
        app.Google.Name = "Bob Secret";
        HttpClient bob = await ScoreTestClients.SignInAsync(app);
        string bobSubject = app.Google.Subject;
        app.Google.Name = "Ada Lovelace";
        Guid adaId = await MeAsync(ada);
        Guid bobId = await MeAsync(bob);

        // Ada: three scores with distinct titles. Bob: one score that must never appear.
        List<Guid> adaScores = [];
        foreach (string title in new[] { "First", "../../evil", "Étude n°1" })
        {
            JsonNode doc = JsonNode.Parse(Small)!;
            doc["meta"]!["title"] = title;
            using HttpResponseMessage created = await ada.PostAsync("/api/scores", Json(doc.ToJsonString()), Ct);
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
            adaScores.Add((await created.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("id").GetGuid());
        }

        JsonNode bobDoc = JsonNode.Parse(Small)!;
        bobDoc["meta"]!["title"] = "Bob private score";
        using (HttpResponseMessage created = await bob.PostAsync("/api/scores", Json(bobDoc.ToJsonString()), Ct))
        {
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        }

        app.Logs.Clear();
        using HttpResponseMessage response = await ada.GetAsync("/api/me/export", Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/zip", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        Assert.Equal("attachment", response.Content.Headers.ContentDisposition?.DispositionType);
        Assert.StartsWith("polymnia-export-", response.Content.Headers.ContentDisposition?.FileName?.Trim('"'), StringComparison.Ordinal);
        Assert.Empty(response.Content.Headers.ContentEncoding); // "the ZIP is never compressed a second time");

        Dictionary<string, byte[]> files = await ReadZipAsync(response);
        Assert.Equal(4, files.Count);
        Assert.Contains("profile.json", files.Keys);
        string[] scoreFiles = [.. files.Keys.Where(k => k != "profile.json")];
        Assert.All(scoreFiles, f => Assert.Matches(@"^scores/[A-Za-z0-9_-]+-[0-9a-f]{32}\.json$", f));

        JsonNode profile = JsonNode.Parse(files["profile.json"])!;
        Assert.Equal(1, (int)profile["formatVersion"]!);
        Assert.Equal(adaId, (Guid)profile["account"]!["id"]!);
        Assert.Equal(adaSubject, (string)profile["account"]!["googleSubject"]!);
        Assert.Equal("Ada Lovelace", (string)profile["account"]!["displayName"]!);
        Assert.Equal(3, profile["scores"]!.AsArray().Count);
        Assert.Equal(adaScores.Order(), profile["scores"]!.AsArray().Select(s => (Guid)s!["id"]!).Order());

        // Each score file is the stored document.
        JsonNode expected = JsonNode.Parse(Small)!;
        foreach (JsonNode? entry in profile["scores"]!.AsArray())
        {
            JsonNode doc = JsonNode.Parse(files[(string)entry!["file"]!])!;
            Assert.Equal((string)entry["title"]!, (string)doc["meta"]!["title"]!);
            Assert.Equal(expected["measures"]!.AsArray().Count, doc["measures"]!.AsArray().Count);
        }

        // Nothing of the other user, and no credential: no session key, hash or ticket.
        string all = string.Concat(files.Values.Select(Encoding.UTF8.GetString));
        Assert.DoesNotContain("Bob", all, StringComparison.Ordinal);
        Assert.DoesNotContain(bobId.ToString(), all, StringComparison.Ordinal);
        Assert.DoesNotContain(bobSubject, all, StringComparison.Ordinal);
        Assert.DoesNotContain("keyHash", all, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("ticket", all, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(AuthDefaults.SessionCookieName, all, StringComparison.Ordinal);
        Assert.Single(profile["account"]!["sessions"]!.AsArray());

        LogCapture.LogEntry audit = Assert.Single(app.Logs.Entries, e => e.EventId.Name == "AuthDataExported");
        Assert.Contains(adaId.ToString(), audit.Message, StringComparison.Ordinal);
        Assert.Contains("3 scores", audit.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("Ada Lovelace", audit.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Export_of_an_empty_library_is_a_valid_archive()
    {
        HttpClient client = await ScoreTestClients.SignInAsync(App);

        using HttpResponseMessage response = await client.GetAsync("/api/me/export", Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Dictionary<string, byte[]> files = await ReadZipAsync(response);
        Assert.Equal(["profile.json"], files.Keys);
    }

    [Fact]
    public async Task Export_requires_a_session()
    {
        var browser = new TestBrowser(App);

        using HttpResponseMessage response = await browser.GetAsync("/api/me/export");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Export_is_rate_limited_per_user_with_retry_after()
    {
        HttpClient client = await ScoreTestClients.SignInAsync(App);
        HttpClient other = await ScoreTestClients.SignInAsync(App);

        for (int i = 0; i < 3; i++)
        {
            using HttpResponseMessage ok = await client.GetAsync("/api/me/export", Ct);
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
            await ok.Content.ReadAsByteArrayAsync(Ct);
        }

        using HttpResponseMessage limited = await client.GetAsync("/api/me/export", Ct);

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.True(limited.Headers.RetryAfter?.Delta > TimeSpan.Zero);

        // Another user has their own budget.
        using HttpResponseMessage fine = await other.GetAsync("/api/me/export", Ct);
        Assert.Equal(HttpStatusCode.OK, fine.StatusCode);
    }

    [Fact]
    public async Task Export_of_the_largest_library_streams_in_bounded_memory()
    {
        TestApp app = App;
        HttpClient client = await ScoreTestClients.SignInAsync(app);
        Guid id = await MeAsync(client);
        int max = new ScoreOptions().MaxScoresPerUser;

        // 200 scores of about 1 MB (a 500-measure, 4-staff score), inserted in one statement.
        await using (var connection = new NpgsqlConnection(fixture.Postgres.ConnectionString))
        {
            await connection.OpenAsync(Ct);
            await using var insert = new NpgsqlCommand(
                """
                INSERT INTO scores (id, owner_id, title, content, schema_version, version, created_at, updated_at)
                SELECT gen_random_uuid(), @owner, 'Bench ' || g, @content::jsonb, 1, 1, now(), now()
                FROM generate_series(1, @count) g
                """,
                connection);
            insert.Parameters.AddWithValue("owner", id);
            insert.Parameters.AddWithValue("content", Big);
            insert.Parameters.AddWithValue("count", max);
            await insert.ExecuteNonQueryAsync(Ct);
        }

        GC.Collect();
        GC.WaitForPendingFinalizers();
        long baseline = GC.GetTotalMemory(forceFullCollection: true);
        long peak = baseline;
        long bytes = 0;
        long entries = 0;
        var clock = Stopwatch.StartNew();

        using HttpResponseMessage response = await client.GetAsync("/api/me/export", HttpCompletionOption.ResponseHeadersRead, Ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using (Stream body = await response.Content.ReadAsStreamAsync(Ct))
        {
            byte[] buffer = new byte[81920];
            int read;
            while ((read = await body.ReadAsync(buffer, Ct)) > 0)
            {
                bytes += read;
                if ((bytes / buffer.Length) % 32 == 0)
                {
                    peak = Math.Max(peak, GC.GetTotalMemory(forceFullCollection: false));
                }
            }
        }

        clock.Stop();

        // Validate the archive from the stream's total size and the central directory: re-request is rate limited
        // (3 per 10 minutes), so the second read is the last allowed one.
        using HttpResponseMessage again = await client.GetAsync("/api/me/export", Ct);
        Dictionary<string, byte[]> files = await ReadZipAsync(again);
        entries = files.Count;
        long uncompressed = files.Values.Sum(f => (long)f.Length);

        long growthMb = (peak - baseline) / (1024 * 1024);
        string report =
            $"PERF export of {max} scores ({uncompressed / (1024 * 1024)} MB of JSON, {bytes / (1024 * 1024)} MB ZIP): " +
            $"{clock.Elapsed.TotalSeconds:F1} s, managed heap growth while streaming {growthMb} MB";
        Console.WriteLine(report);
        TestContext.Current.SendDiagnosticMessage(report);
        if (Environment.GetEnvironmentVariable("POLYMNIA_PERF_REPORT") is { Length: > 0 } reportFile)
        {
            await File.AppendAllTextAsync(reportFile, report + Environment.NewLine, Ct);
        }

        // The 200 MB of rows go away with the account (also exercises the cascade on a large library).
        using (HttpResponseMessage cleanup = await client.DeleteAsync("/api/me", Ct))
        {
            Assert.Equal(HttpStatusCode.NoContent, cleanup.StatusCode);
        }

        Assert.Equal(max + 1, entries);
        Assert.True(uncompressed > 150L * 1024 * 1024, report);
        // The archive is hundreds of MB of JSON: it must not be buffered (a generous bound, other tests share the process).
        Assert.True(growthMb < 120, report);
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(60), report);
    }

    // ---- pure helpers ----------------------------------------------------------------------------------------

    [Theory]
    [InlineData("First score", "scores/First-score-")]
    [InlineData("../../etc/passwd", "scores/etc_passwd-")]
    [InlineData("Étude", "scores/tude-")]
    [InlineData("...", "scores/score-")]
    [InlineData("C:\\win\\x", "scores/C__win_x-")]
    public void Score_file_names_are_safe_and_unique(string title, string prefix)
    {
        var id = Guid.Parse("0190c0de-0000-7000-8000-000000000001");
        string name = AccountEndpoints.ScoreFileName(new Polymnia.Core.Users.ScoreExportRow(id, title, 1, 1, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow));

        Assert.Equal(prefix + "0190c0de00007000800000000000000" + "1.json", name);
        Assert.DoesNotContain("..", name, StringComparison.Ordinal);
        Assert.Equal(1, name.Count(c => c == '/'));
    }

    [Fact]
    public void A_very_long_title_is_cut()
    {
        string name = AccountEndpoints.ScoreFileName(new Polymnia.Core.Users.ScoreExportRow(Guid.NewGuid(), new string('a', 500), 1, 1, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow));

        Assert.True(name.Length < 120);
    }

    [Fact]
    public async Task Database_is_the_only_place_a_score_lives_after_deletion_of_the_owner()
    {
        // Direct check of the cascade at the store level, without HTTP.
        TestApp app = App;
        HttpClient client = await ScoreTestClients.SignInAsync(app);
        Guid id = await MeAsync(client);
        await CreateScoresAsync(client, 1);

        using IServiceScope scope = app.Services.CreateScope();
        var accounts = scope.ServiceProvider.GetRequiredService<Polymnia.Infrastructure.Users.AccountStore>();
        Assert.True(await accounts.DeleteAsync(id, Ct));
        Assert.False(await accounts.DeleteAsync(id, Ct));

        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        Assert.False(await db.Scores.AnyAsync(s => s.OwnerId == id, Ct));
    }
}
