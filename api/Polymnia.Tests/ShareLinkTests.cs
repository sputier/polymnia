using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Polymnia.Core.Sharing;
using Polymnia.Infrastructure;

namespace Polymnia.Tests;

/// <summary>Token format only: no database.</summary>
public sealed class ShareTokenTests
{
    [Fact]
    public void A_token_is_256_random_bits_as_43_base64url_characters()
    {
        string token = ShareToken.Generate();

        Assert.Equal(ShareToken.TextLength, token.Length);
        Assert.Matches("^[A-Za-z0-9_-]{43}$", token);
        Assert.True(ShareToken.IsWellFormed(token));
        // 43 base64url characters decode to exactly 32 bytes.
        string padded = token.Replace('-', '+').Replace('_', '/') + "=";
        Assert.Equal(32, Convert.FromBase64String(padded).Length);
    }

    [Fact]
    public void Tokens_do_not_repeat()
    {
        HashSet<string> seen = [.. Enumerable.Range(0, 2000).Select(_ => ShareToken.Generate())];
        Assert.Equal(2000, seen.Count);
    }

    [Fact]
    public void The_hash_is_sha256_of_the_text()
    {
        const string token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
        Assert.Equal(SHA256.HashData(Encoding.ASCII.GetBytes(token)), ShareToken.Hash(token));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("short")]
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")] // 44 characters
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa+")] // not base64url
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab")] // last character with non-zero padding bits
    public void Malformed_tokens_are_refused(string? value) => Assert.False(ShareToken.IsWellFormed(value));
}

/// <summary>Share links against a real PostgreSQL (Testcontainers).</summary>
public sealed class ShareLinkTests(ScoreApiFixture fixture) : IClassFixture<ScoreApiFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly string Small = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "score-small.json"));

    private async Task<HttpClient> SignedInAsync(bool sendToken = true)
    {
        fixture.Postgres.SkipIfUnavailable();
        return await ScoreTestClients.SignInAsync(fixture.App, sendToken);
    }

    private HttpClient Anonymous(TestApp? app = null, string? ip = null)
    {
        fixture.Postgres.SkipIfUnavailable();
        HttpClient client = (app ?? fixture.App).CreateSecureClient();
        client.DefaultRequestHeaders.TryAddWithoutValidation(ClientIpStartupFilter.Header, ip ?? RandomIp());
        return client;
    }

    private static string RandomIp()
    {
        byte[] r = RandomNumberGenerator.GetBytes(3);
        return $"10.{r[0]}.{r[1]}.{r[2]}";
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private static async Task<JsonElement> Body(HttpResponseMessage response) =>
        (await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(Ct), cancellationToken: Ct)).RootElement.Clone();

    private static async Task<Guid> CreateScoreAsync(HttpClient client)
    {
        using HttpResponseMessage created = await client.PostAsync("/api/scores", Json(Small), Ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        return (await Body(created)).GetProperty("id").GetGuid();
    }

    private static async Task<string> ShareAsync(HttpClient client, Guid scoreId)
    {
        using HttpResponseMessage response = await client.PostAsync($"/api/scores/{scoreId}/share", null, Ct);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await Body(response)).GetProperty("token").GetString()!;
    }

    // ---- owner side ----------------------------------------------------------------------------------------

    [Fact]
    public async Task Creating_a_link_returns_the_token_once_and_stores_only_its_hash()
    {
        using HttpClient owner = await SignedInAsync();
        Guid id = await CreateScoreAsync(owner);

        using HttpResponseMessage created = await owner.PostAsync($"/api/scores/{id}/share", null, Ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal("no-store", created.Headers.CacheControl?.ToString());
        Assert.Empty(created.Content.Headers.ContentEncoding);
        string token = (await Body(created)).GetProperty("token").GetString()!;
        Assert.True(ShareToken.IsWellFormed(token));

        // The status never repeats the token.
        using HttpResponseMessage status = await owner.GetAsync($"/api/scores/{id}/share", Ct);
        string statusText = await status.Content.ReadAsStringAsync(Ct);
        Assert.DoesNotContain(token, statusText, StringComparison.Ordinal);
        JsonElement statusJson = JsonDocument.Parse(statusText).RootElement;
        Assert.True(statusJson.GetProperty("active").GetBoolean());
        Assert.False(statusJson.TryGetProperty("token", out _));

        // The database holds the SHA-256 hash and nothing else derived from the token.
        using IServiceScope scope = fixture.App.Services.CreateScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        ShareLink row = await db.ShareLinks.AsNoTracking().SingleAsync(l => l.ScoreId == id, Ct);
        Assert.Equal(ShareToken.Hash(token), row.TokenHash);
        Assert.DoesNotContain(token, Convert.ToBase64String(row.TokenHash), StringComparison.Ordinal);
        Assert.Null(row.RevokedAt);
    }

    [Fact]
    public async Task Without_a_link_the_status_is_inactive_and_revoking_is_idempotent()
    {
        using HttpClient owner = await SignedInAsync();
        Guid id = await CreateScoreAsync(owner);

        using HttpResponseMessage status = await owner.GetAsync($"/api/scores/{id}/share", Ct);
        Assert.False((await Body(status)).GetProperty("active").GetBoolean());
        using HttpResponseMessage revoke = await owner.DeleteAsync($"/api/scores/{id}/share", Ct);
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);
    }

    [Fact]
    public async Task Regenerating_revokes_the_previous_link_and_a_score_keeps_one_active_link()
    {
        using HttpClient owner = await SignedInAsync();
        Guid id = await CreateScoreAsync(owner);
        string first = await ShareAsync(owner, id);
        string second = await ShareAsync(owner, id);
        string third = await ShareAsync(owner, id);
        Assert.NotEqual(first, second);

        using HttpClient viewer = Anonymous();
        using HttpResponseMessage oldOne = await viewer.GetAsync($"/api/shared/{second}", Ct);
        using HttpResponseMessage current = await viewer.GetAsync($"/api/shared/{third}", Ct);
        Assert.Equal(HttpStatusCode.NotFound, oldOne.StatusCode);
        Assert.Equal(HttpStatusCode.OK, current.StatusCode);

        using IServiceScope scope = fixture.App.Services.CreateScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        List<ShareLink> rows = await db.ShareLinks.AsNoTracking().Where(l => l.ScoreId == id).ToListAsync(Ct);
        Assert.Equal(1, rows.Count(r => r.RevokedAt is null));
        Assert.True(rows.Count <= 2, "old revoked links are cleaned up");
    }

    [Fact]
    public async Task Concurrent_creations_never_leave_two_active_links()
    {
        using HttpClient owner = await SignedInAsync();
        Guid id = await CreateScoreAsync(owner);

        HttpResponseMessage[] responses = await Task.WhenAll(Enumerable.Range(0, 2)
            .Select(_ => owner.PostAsync($"/api/scores/{id}/share", null, Ct)));
        foreach (HttpResponseMessage r in responses)
        {
            Assert.True(r.StatusCode is HttpStatusCode.Created or HttpStatusCode.Conflict, r.StatusCode.ToString());
            r.Dispose();
        }

        using IServiceScope scope = fixture.App.Services.CreateScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        Assert.Equal(1, await db.ShareLinks.CountAsync(l => l.ScoreId == id && l.RevokedAt == null, Ct));
    }

    [Fact]
    public async Task Only_the_owner_can_manage_the_link_other_users_get_404()
    {
        using HttpClient owner = await SignedInAsync();
        using HttpClient other = await SignedInAsync();
        Guid id = await CreateScoreAsync(owner);
        string token = await ShareAsync(owner, id);

        using HttpResponseMessage status = await other.GetAsync($"/api/scores/{id}/share", Ct);
        using HttpResponseMessage create = await other.PostAsync($"/api/scores/{id}/share", null, Ct);
        using HttpResponseMessage revoke = await other.DeleteAsync($"/api/scores/{id}/share", Ct);
        Assert.Equal(HttpStatusCode.NotFound, status.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, create.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, revoke.StatusCode);

        // Same answer as a score that does not exist.
        using HttpResponseMessage missing = await other.GetAsync($"/api/scores/{Guid.NewGuid()}/share", Ct);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);

        // The other user changed nothing: the link still works.
        using HttpClient viewer = Anonymous();
        using HttpResponseMessage shared = await viewer.GetAsync($"/api/shared/{token}", Ct);
        Assert.Equal(HttpStatusCode.OK, shared.StatusCode);
    }

    [Fact]
    public async Task Owner_endpoints_require_a_session_and_the_antiforgery_header()
    {
        using HttpClient owner = await SignedInAsync();
        using HttpClient noToken = await SignedInAsync(sendToken: false);
        using HttpClient anonymous = Anonymous();
        Guid id = await CreateScoreAsync(owner);

        using HttpResponseMessage anonymousGet = await anonymous.GetAsync($"/api/scores/{id}/share", Ct);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymousGet.StatusCode);
        using HttpResponseMessage anonymousPost = await anonymous.PostAsync($"/api/scores/{id}/share", null, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, anonymousPost.StatusCode);

        // A signed-in caller without the header: refused before anything happens.
        using HttpResponseMessage create = await noToken.PostAsync($"/api/scores/{id}/share", null, Ct);
        using HttpResponseMessage revoke = await noToken.DeleteAsync($"/api/scores/{id}/share", Ct);
        Assert.Equal(HttpStatusCode.BadRequest, create.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, revoke.StatusCode);
        using HttpResponseMessage status = await owner.GetAsync($"/api/scores/{id}/share", Ct);
        Assert.False((await Body(status)).GetProperty("active").GetBoolean());
    }

    // ---- public side ---------------------------------------------------------------------------------------

    [Fact]
    public async Task A_valid_token_returns_the_score_read_only_with_privacy_headers()
    {
        using HttpClient owner = await SignedInAsync();
        Guid id = await CreateScoreAsync(owner);
        string token = await ShareAsync(owner, id);

        using HttpClient viewer = Anonymous();
        using HttpResponseMessage response = await viewer.GetAsync($"/api/shared/{token}", Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Contains("noindex", response.Headers.GetValues("X-Robots-Tag").Single(), StringComparison.Ordinal);
        Assert.Equal("no-referrer", response.Headers.GetValues("Referrer-Policy").Single());
        Assert.False(response.Headers.Contains("Set-Cookie"));
        string body = await response.Content.ReadAsStringAsync(Ct);
        Assert.DoesNotContain(token, body, StringComparison.Ordinal);
        JsonElement document = JsonDocument.Parse(body).RootElement;
        Assert.Equal(JsonDocument.Parse(Small).RootElement.GetProperty("meta").GetProperty("title").GetString(), document.GetProperty("meta").GetProperty("title").GetString());
    }

    [Fact]
    public async Task The_viewer_sees_later_edits_of_the_owner()
    {
        using HttpClient owner = await SignedInAsync();
        Guid id = await CreateScoreAsync(owner);
        string token = await ShareAsync(owner, id);

        using HttpResponseMessage rename = await owner.SendAsync(
            new HttpRequestMessage(HttpMethod.Patch, $"/api/scores/{id}")
            {
                Content = Json("{\"title\":\"Renamed after sharing\"}"),
                Headers = { { "If-Match", "\"1\"" } },
            }, Ct);
        Assert.Equal(HttpStatusCode.OK, rename.StatusCode);

        using HttpClient viewer = Anonymous();
        using HttpResponseMessage response = await viewer.GetAsync($"/api/shared/{token}", Ct);
        Assert.Equal("Renamed after sharing", (await Body(response)).GetProperty("meta").GetProperty("title").GetString());
    }

    [Fact]
    public async Task Unknown_malformed_and_revoked_tokens_all_answer_the_same_404()
    {
        using HttpClient owner = await SignedInAsync();
        Guid id = await CreateScoreAsync(owner);
        string revoked = await ShareAsync(owner, id);
        using HttpResponseMessage revoke = await owner.DeleteAsync($"/api/scores/{id}/share", Ct);
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);

        using HttpClient viewer = Anonymous();
        string[] attempts = [revoked, ShareToken.Generate(), "short", new string('A', 43), "%20%20", new string('x', 300)];
        string? reference = null;
        foreach (string attempt in attempts)
        {
            using HttpResponseMessage response = await viewer.GetAsync($"/api/shared/{attempt}", Ct);
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
            Assert.Contains("noindex", response.Headers.GetValues("X-Robots-Tag").Single(), StringComparison.Ordinal);
            Assert.Equal("no-referrer", response.Headers.GetValues("Referrer-Policy").Single());
            JsonElement problem = await Body(response);
            // Same shape; the trace id is the only part that changes.
            string shape = $"{problem.GetProperty("title")}|{problem.GetProperty("status")}|{problem.EnumerateObject().Count()}";
            reference ??= shape;
            Assert.Equal(reference, shape);
            Assert.DoesNotContain(attempt, problem.ToString(), StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task The_token_cannot_be_used_to_write()
    {
        using HttpClient owner = await SignedInAsync();
        Guid id = await CreateScoreAsync(owner);
        string token = await ShareAsync(owner, id);
        using HttpResponseMessage before = await owner.GetAsync($"/api/scores/{id}", Ct);
        string original = await before.Content.ReadAsStringAsync(Ct);

        using HttpClient viewer = Anonymous();
        foreach (HttpMethod method in new[] { HttpMethod.Post, HttpMethod.Put, HttpMethod.Patch, HttpMethod.Delete, HttpMethod.Options, new HttpMethod("TRACE") })
        {
            // Anonymous: the antiforgery check refuses unsafe methods first.
            using HttpResponseMessage anonymous = await viewer.SendAsync(
                new HttpRequestMessage(method, $"/api/shared/{token}") { Content = Json(Small) }, Ct);
            Assert.False(anonymous.IsSuccessStatusCode, $"{method} (anonymous) -> {anonymous.StatusCode}");

            // Even with a valid session and antiforgery token (the owner's), the route is GET only.
            using HttpResponseMessage withToken = await owner.SendAsync(
                new HttpRequestMessage(method, $"/api/shared/{token}") { Content = Json(Small) }, Ct);
            Assert.True(
                withToken.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed,
                $"{method} (with token) -> {withToken.StatusCode}");
        }

        // The token is no key to the owner API either.
        using HttpResponseMessage api = await viewer.GetAsync($"/api/scores/{id}?token={token}", Ct);
        Assert.Equal(HttpStatusCode.Unauthorized, api.StatusCode);
        using HttpRequestMessage bearer = new(HttpMethod.Get, $"/api/scores/{id}");
        bearer.Headers.TryAddWithoutValidation("Authorization", "Bearer " + token);
        using HttpResponseMessage viaHeader = await viewer.SendAsync(bearer, Ct);
        Assert.Equal(HttpStatusCode.Unauthorized, viaHeader.StatusCode);

        using HttpResponseMessage after = await owner.GetAsync($"/api/scores/{id}", Ct);
        Assert.Equal(original, await after.Content.ReadAsStringAsync(Ct));
    }

    [Fact]
    public async Task Revoking_makes_the_link_return_404_at_once()
    {
        using HttpClient owner = await SignedInAsync();
        Guid id = await CreateScoreAsync(owner);
        string token = await ShareAsync(owner, id);
        using HttpClient viewer = Anonymous();
        using HttpResponseMessage ok = await viewer.GetAsync($"/api/shared/{token}", Ct);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);

        using HttpResponseMessage revoke = await owner.DeleteAsync($"/api/scores/{id}/share", Ct);
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);

        using HttpResponseMessage gone = await viewer.GetAsync($"/api/shared/{token}", Ct);
        Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);
        using HttpResponseMessage status = await owner.GetAsync($"/api/scores/{id}/share", Ct);
        Assert.False((await Body(status)).GetProperty("active").GetBoolean());
    }

    [Fact]
    public async Task The_public_endpoint_is_rate_limited_per_client_address()
    {
        fixture.Postgres.SkipIfUnavailable();
        using var app = new TestApp(
            connectionString: fixture.Postgres.ConnectionString,
            settings: new() { ["RateLimiting:Shared:PermitLimit"] = "3" });
        string token = ShareToken.Generate();

        using HttpClient noisy = Anonymous(app, "10.1.1.1");
        HttpStatusCode[] codes = new HttpStatusCode[5];
        HttpResponseMessage? last = null;
        for (int i = 0; i < codes.Length; i++)
        {
            last?.Dispose();
            last = await noisy.GetAsync($"/api/shared/{token}", Ct);
            codes[i] = last.StatusCode;
        }

        Assert.Equal([HttpStatusCode.NotFound, HttpStatusCode.NotFound, HttpStatusCode.NotFound, HttpStatusCode.TooManyRequests, HttpStatusCode.TooManyRequests], codes);
        Assert.NotNull(last!.Headers.RetryAfter);
        last.Dispose();

        // Another address has its own budget.
        using HttpClient calm = Anonymous(app, "10.2.2.2");
        using HttpResponseMessage other = await calm.GetAsync($"/api/shared/{token}", Ct);
        Assert.Equal(HttpStatusCode.NotFound, other.StatusCode);
    }

    [Fact]
    public async Task Ipv6_clients_share_one_budget_per_slash_64()
    {
        fixture.Postgres.SkipIfUnavailable();
        using var app = new TestApp(
            connectionString: fixture.Postgres.ConnectionString,
            settings: new() { ["RateLimiting:Shared:PermitLimit"] = "2" });
        string token = ShareToken.Generate();

        using HttpClient a = Anonymous(app, "2001:db8:1:2::1");
        using HttpClient b = Anonymous(app, "2001:db8:1:2:ffff::9");
        using HttpClient elsewhere = Anonymous(app, "2001:db8:1:3::1");
        using HttpResponseMessage r1 = await a.GetAsync($"/api/shared/{token}", Ct);
        using HttpResponseMessage r2 = await b.GetAsync($"/api/shared/{token}", Ct);
        using HttpResponseMessage r3 = await a.GetAsync($"/api/shared/{token}", Ct);
        using HttpResponseMessage r4 = await elsewhere.GetAsync($"/api/shared/{token}", Ct);

        Assert.Equal(HttpStatusCode.TooManyRequests, r3.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, r4.StatusCode);
    }

    // ---- lifecycle and logs --------------------------------------------------------------------------------

    [Fact]
    public async Task Deleting_the_score_removes_its_links()
    {
        using HttpClient owner = await SignedInAsync();
        Guid id = await CreateScoreAsync(owner);
        string token = await ShareAsync(owner, id);
        await ShareAsync(owner, id);

        using HttpResponseMessage delete = await owner.DeleteAsync($"/api/scores/{id}", Ct);
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);

        using IServiceScope scope = fixture.App.Services.CreateScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        Assert.Equal(0, await db.ShareLinks.CountAsync(l => l.ScoreId == id, Ct));
        using HttpClient viewer = Anonymous();
        using HttpResponseMessage gone = await viewer.GetAsync($"/api/shared/{token}", Ct);
        Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);
    }

    [Fact]
    public async Task Deleting_the_user_removes_their_scores_and_links()
    {
        using HttpClient owner = await SignedInAsync();
        Guid id = await CreateScoreAsync(owner);
        await ShareAsync(owner, id);

        using IServiceScope scope = fixture.App.Services.CreateScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        Guid ownerId = await db.Scores.AsNoTracking().Where(s => s.Id == id).Select(s => s.OwnerId).SingleAsync(Ct);
        Assert.Equal(1, await db.Users.Where(u => u.Id == ownerId).ExecuteDeleteAsync(Ct));

        Assert.Equal(0, await db.ShareLinks.CountAsync(l => l.ScoreId == id, Ct));
    }

    [Fact]
    public async Task The_token_never_appears_in_the_logs_but_the_audit_events_do()
    {
        fixture.Postgres.SkipIfUnavailable();
        // Everything at Information, the framework included: the only place a token can leak from is the request path.
        using var app = new TestApp(
            connectionString: fixture.Postgres.ConnectionString,
            settings: new() { ["Logging:LogLevel:Default"] = "Trace", ["Logging:LogLevel:Microsoft.AspNetCore"] = "Trace" });
        using HttpClient owner = await ScoreTestClients.SignInAsync(app);
        Guid id = await CreateScoreAsync(owner);
        string token = await ShareAsync(owner, id);

        using HttpClient viewer = Anonymous(app);
        using HttpResponseMessage ok = await viewer.GetAsync($"/api/shared/{token}", Ct);
        string wrong = ShareToken.Generate();
        using HttpResponseMessage missing = await viewer.GetAsync($"/api/shared/{wrong}", Ct);
        using HttpResponseMessage revoke = await owner.DeleteAsync($"/api/scores/{id}/share", Ct);
        using HttpResponseMessage gone = await viewer.GetAsync($"/api/shared/{token}", Ct);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);

        string hashBase64 = Convert.ToBase64String(ShareToken.Hash(token));
        string hashHex = Convert.ToHexString(ShareToken.Hash(token));
        foreach (LogCapture.LogEntry entry in app.Logs.Entries)
        {
            foreach (string secret in new[] { token, wrong, hashBase64, hashHex })
            {
                // Request logging at Trace level records the path of the public endpoint: that is why ASP.NET Core is
                // kept at Warning in appsettings.json. Here it is forced on, so only the application's own events
                // and the database commands are asserted.
                if (entry.Category.StartsWith("Microsoft.AspNetCore", StringComparison.Ordinal))
                {
                    continue;
                }

                Assert.DoesNotContain(secret, entry.Message, StringComparison.Ordinal);
            }
        }

        Assert.Contains(app.Logs.Entries, e => e.EventId.Name == "ShareLinkCreated");
        Assert.Contains(app.Logs.Entries, e => e.EventId.Name == "ShareLinkRevoked");
    }

    [Fact]
    public async Task With_the_default_log_levels_no_log_entry_contains_the_token()
    {
        fixture.Postgres.SkipIfUnavailable();
        using var app = new TestApp(connectionString: fixture.Postgres.ConnectionString);
        using HttpClient owner = await ScoreTestClients.SignInAsync(app);
        Guid id = await CreateScoreAsync(owner);
        string token = await ShareAsync(owner, id);
        using HttpClient viewer = Anonymous(app);
        using HttpResponseMessage ok = await viewer.GetAsync($"/api/shared/{token}", Ct);

        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.DoesNotContain(app.Logs.Entries, e => e.Message.Contains(token, StringComparison.Ordinal));
    }
}
