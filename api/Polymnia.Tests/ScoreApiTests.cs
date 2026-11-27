using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Polymnia.Core.Scores;
using Polymnia.Infrastructure;

namespace Polymnia.Tests;

/// <summary>Owns a migrated PostgreSQL database and a test host for the score API tests.</summary>
public sealed class ScoreApiFixture : IAsyncLifetime
{
    private readonly PostgresFixture _postgres = new();

    internal TestApp App { get; private set; } = null!;

    public PostgresFixture Postgres => _postgres;

    public async ValueTask InitializeAsync()
    {
        await _postgres.InitializeAsync();
        if (_postgres.UnavailableReason is not null)
        {
            return;
        }

        App = new TestApp(connectionString: _postgres.ConnectionString);
        await MigrateAsync(App);
    }

    internal static async Task MigrateAsync(TestApp app)
    {
        using IServiceScope scope = app.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<PolymniaDbContext>()
            .Database.MigrateAsync(TestContext.Current.CancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
        App?.Dispose();
        await _postgres.DisposeAsync();
    }
}

/// <summary>One test (at least) per endpoint, against a real PostgreSQL (Testcontainers).</summary>
public sealed class ScoreApiTests(ScoreApiFixture fixture) : IClassFixture<ScoreApiFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly string Small = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "score-small.json"));
    private static readonly string Big = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "score-500-measures.json"));

    private async Task<HttpClient> SignedInAsync(bool sendToken = true)
    {
        fixture.Postgres.SkipIfUnavailable();
        return await ScoreTestClients.SignInAsync(fixture.App, sendToken);
    }

    private HttpClient Anonymous()
    {
        fixture.Postgres.SkipIfUnavailable();
        return fixture.App.CreateSecureClient();
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private static string WithTitle(string title, string source = null!)
    {
        JsonNode node = JsonNode.Parse(source ?? Small)!;
        node["meta"]!["title"] = title;
        return node.ToJsonString();
    }

    private static HttpRequestMessage Req(HttpMethod method, string url, HttpContent? body = null, string? ifMatch = null)
    {
        HttpRequestMessage request = new(method, url) { Content = body };
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        }

        return request;
    }

    private static async Task<JsonElement> Body(HttpResponseMessage response) =>
        (await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(Ct), cancellationToken: Ct)).RootElement.Clone();

    private static async Task<(Guid Id, string ETag)> CreateAsync(HttpClient client, string? json = null)
    {
        using HttpResponseMessage created = await client.PostAsync("/api/scores", Json(json ?? Small), Ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        JsonElement body = await Body(created);
        return (body.GetProperty("id").GetGuid(), created.Headers.ETag!.Tag);
    }

    // ---- authentication ------------------------------------------------------------------------------------

    [Fact]
    public async Task Every_endpoint_requires_authentication()
    {
        using HttpClient anonymous = Anonymous();
        Guid id = Guid.NewGuid();
        (HttpMethod, string)[] calls =
        [
            (HttpMethod.Get, "/api/scores"), (HttpMethod.Get, $"/api/scores/{id}"), (HttpMethod.Post, "/api/scores"),
            (HttpMethod.Put, $"/api/scores/{id}"), (HttpMethod.Patch, $"/api/scores/{id}"),
            (HttpMethod.Post, $"/api/scores/{id}/duplicate"), (HttpMethod.Delete, $"/api/scores/{id}"),
        ];
        foreach ((HttpMethod method, string url) in calls)
        {
            using HttpResponseMessage response = await anonymous.SendAsync(Req(method, url, Json("{}"), "\"1\""), Ct);
            // Reads: 401. Unsafe methods: the antiforgery check (400) comes first, and an anonymous caller has no valid token.
            HttpStatusCode expected = method == HttpMethod.Get ? HttpStatusCode.Unauthorized : HttpStatusCode.BadRequest;
            Assert.True(response.StatusCode == expected, $"{method} {url} -> {response.StatusCode}");
        }
    }

    [Fact]
    public async Task Unsafe_methods_need_the_antiforgery_header_including_duplicate_and_delete()
    {
        using HttpClient noToken = await SignedInAsync(sendToken: false);
        using HttpClient withToken = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(withToken);

        (HttpMethod, string, HttpContent?)[] calls =
        [
            (HttpMethod.Post, "/api/scores", Json(Small)),
            (HttpMethod.Put, $"/api/scores/{id}", Json(Small)),
            (HttpMethod.Patch, $"/api/scores/{id}", JsonContent.Create(new { title = "x" })),
            (HttpMethod.Post, $"/api/scores/{id}/duplicate", null),
            (HttpMethod.Delete, $"/api/scores/{id}", null),
        ];
        foreach ((HttpMethod method, string url, HttpContent? body) in calls)
        {
            using HttpResponseMessage response = await noToken.SendAsync(Req(method, url, body, etag), Ct);
            Assert.True(response.StatusCode == HttpStatusCode.BadRequest, $"{method} {url} -> {response.StatusCode}");
            Assert.Contains("antiforgery", await response.Content.ReadAsStringAsync(Ct), StringComparison.Ordinal);
        }

        // The score is untouched (not deleted, not duplicated).
        using HttpResponseMessage list = await withToken.GetAsync("/api/scores", Ct);
        Assert.Equal(1, (await Body(list)).GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task Deleting_a_user_deletes_their_scores()
    {
        fixture.Postgres.SkipIfUnavailable();
        using HttpClient client = await SignedInAsync();
        (Guid id, _) = await CreateAsync(client);
        using IServiceScope scope = fixture.App.Services.CreateScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();

        Guid owner = await db.Scores.Where(s => s.Id == id).Select(s => s.OwnerId).SingleAsync(Ct);
        await db.Users.Where(u => u.Id == owner).ExecuteDeleteAsync(Ct);

        Assert.False(await db.Scores.AnyAsync(s => s.Id == id, Ct));
    }

    // ---- create --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Create_stores_the_score_and_returns_201_with_location_and_etag()
    {
        using HttpClient client = await SignedInAsync();
        using HttpResponseMessage response = await client.PostAsync("/api/scores", Json(WithTitle("  My piece  ")), Ct);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        JsonElement body = await Body(response);
        Guid id = body.GetProperty("id").GetGuid();
        Assert.Equal("My piece", body.GetProperty("title").GetString());
        Assert.Equal(1, body.GetProperty("schemaVersion").GetInt32());
        Assert.Equal("\"1\"", response.Headers.ETag!.Tag);
        Assert.Equal($"/api/scores/{id}", response.Headers.Location!.OriginalString);
    }

    [Theory]
    [InlineData("{ not json")]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("{\"schemaVersion\":1}")]
    public async Task Create_rejects_invalid_json_or_schema_with_400(string body)
    {
        using HttpClient client = await SignedInAsync();
        using HttpResponseMessage response = await client.PostAsync("/api/scores", Json(body), Ct);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType!.MediaType);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(0)]
    public async Task Create_rejects_an_unknown_schema_version_with_400(int version)
    {
        JsonNode node = JsonNode.Parse(Small)!;
        node["schemaVersion"] = version;
        using HttpClient client = await SignedInAsync();
        using HttpResponseMessage response = await client.PostAsync("/api/scores", Json(node.ToJsonString()), Ct);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Unsupported schemaVersion", await response.Content.ReadAsStringAsync(Ct), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Create_rejects_unknown_properties_and_oversized_titles()
    {
        using HttpClient client = await SignedInAsync();
        JsonNode extra = JsonNode.Parse(Small)!;
        extra["evil"] = 1;
        using HttpResponseMessage unknown = await client.PostAsync("/api/scores", Json(extra.ToJsonString()), Ct);
        using HttpResponseMessage longTitle = await client.PostAsync("/api/scores", Json(WithTitle(new string('a', 201))), Ct);

        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, longTitle.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_control_characters_in_the_title()
    {
        using HttpClient client = await SignedInAsync();
        using HttpResponseMessage response = await client.PostAsync("/api/scores", Json(WithTitle("a\u0007b")), Ct);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_a_nul_escape_that_jsonb_cannot_store_with_400_not_500()
    {
        JsonNode node = JsonNode.Parse(Small)!;
        node["parts"]![0]!["name"] = "a\u0000b";
        using HttpClient client = await SignedInAsync();
        using HttpResponseMessage response = await client.PostAsync("/api/scores", Json(node.ToJsonString()), Ct);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_byte_order_mark_and_a_nul_in_the_search_are_400_not_500()
    {
        using HttpClient client = await SignedInAsync();
        using HttpResponseMessage bom = await client.PostAsync(
            "/api/scores", new ByteArrayContent([0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes(Small)]) { Headers = { ContentType = new("application/json") } }, Ct);
        using HttpResponseMessage nul = await client.GetAsync("/api/scores?q=%00", Ct);

        Assert.Equal(HttpStatusCode.BadRequest, bom.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, nul.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_an_empty_title_and_stores_the_trimmed_title_in_the_document()
    {
        using HttpClient client = await SignedInAsync();
        using HttpResponseMessage empty = await client.PostAsync("/api/scores", Json(WithTitle("   ")), Ct);
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);

        (Guid id, _) = await CreateAsync(client, WithTitle("  Padded  "));
        using HttpResponseMessage get = await client.GetAsync($"/api/scores/{id}", Ct);
        Assert.Equal("Padded", (await Body(get)).GetProperty("meta").GetProperty("title").GetString());
    }

    [Fact]
    public async Task The_database_refuses_a_non_object_document()
    {
        fixture.Postgres.SkipIfUnavailable();
        using IServiceScope scope = fixture.App.Services.CreateScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        using HttpClient client = await SignedInAsync();
        (Guid id, _) = await CreateAsync(client);
        Npgsql.PostgresException ex = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE scores SET content = '[]'::jsonb WHERE id = {id}", Ct));
        Assert.Equal("ck_scores_content_object", ex.ConstraintName);
    }

    [Fact]
    public async Task Gzip_request_bodies_are_accepted_and_the_decompressed_size_is_capped()
    {
        using HttpClient client = await SignedInAsync();
        using HttpResponseMessage ok = await client.PostAsync("/api/scores", Gzip(Small), Ct);
        Assert.Equal(HttpStatusCode.Created, ok.StatusCode);

        // A few KB on the wire, far more than 4 MiB once decompressed.
        string bomb = "{\"pad\":\"" + new string('x', ScoreLimits.MaxContentBytes * 3) + "\"}";
        using HttpResponseMessage tooBig = await client.PostAsync("/api/scores", Gzip(bomb), Ct);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, tooBig.StatusCode);

        using HttpRequestMessage unknown = Req(HttpMethod.Post, "/api/scores", Json(Small));
        unknown.Content!.Headers.ContentEncoding.Add("compress");
        using HttpResponseMessage unsupported = await client.SendAsync(unknown, Ct);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, unsupported.StatusCode);

        // A corrupt gzip stream is a client error, not a 500.
        ByteArrayContent corrupt = new([1, 2, 3, 4, 5]);
        corrupt.Headers.ContentType = new("application/json");
        corrupt.Headers.ContentEncoding.Add("gzip");
        using HttpResponseMessage broken = await client.PostAsync("/api/scores", corrupt, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, broken.StatusCode);
    }

    private static ByteArrayContent Gzip(string json)
    {
        using MemoryStream output = new();
        using (System.IO.Compression.GZipStream gzip = new(output, System.IO.Compression.CompressionLevel.Fastest, leaveOpen: true))
        {
            gzip.Write(Encoding.UTF8.GetBytes(json));
        }

        ByteArrayContent content = new(output.ToArray());
        content.Headers.ContentType = new("application/json");
        content.Headers.ContentEncoding.Add("gzip");
        return content;
    }

    [Fact]
    public async Task Reads_are_rate_limited_per_user_too()
    {
        fixture.Postgres.SkipIfUnavailable();
        using var app = new TestApp(
            connectionString: fixture.Postgres.ConnectionString,
            settings: new() { ["RateLimiting:ScoreWrites:ReadPermitLimit"] = "2" });
        using HttpClient client = await ScoreTestClients.SignInAsync(app);

        using HttpResponseMessage a = await client.GetAsync("/api/scores", Ct);
        using HttpResponseMessage b = await client.GetAsync("/api/scores", Ct);
        using HttpResponseMessage c = await client.GetAsync("/api/scores", Ct);

        Assert.Equal(HttpStatusCode.OK, b.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, c.StatusCode);
        Assert.NotNull(c.Headers.RetryAfter);
        Assert.Equal(HttpStatusCode.OK, a.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_a_non_json_content_type_with_415()
    {
        using HttpClient client = await SignedInAsync();
        using HttpResponseMessage response = await client.PostAsync(
            "/api/scores", new StringContent(Small, Encoding.UTF8, "text/plain"), Ct);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_an_oversized_body_with_413()
    {
        using HttpClient client = await SignedInAsync();
        string huge = "{\"pad\":\"" + new string('x', ScoreLimits.MaxContentBytes) + "\"}";
        using HttpResponseMessage declared = await client.PostAsync("/api/scores", Json(huge), Ct);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, declared.StatusCode);

        // No Content-Length (chunked): the limit is enforced while reading.
        using HttpRequestMessage chunked = Req(HttpMethod.Post, "/api/scores", new StreamContent(new MemoryStream(Encoding.UTF8.GetBytes(huge))));
        chunked.Content!.Headers.ContentType = new("application/json");
        chunked.Headers.TransferEncodingChunked = true;
        using HttpResponseMessage streamed = await client.SendAsync(chunked, Ct);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, streamed.StatusCode);
    }

    [Fact]
    public async Task A_500_measure_score_is_accepted()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, _) = await CreateAsync(client, Big);
        using HttpResponseMessage get = await client.GetAsync($"/api/scores/{id}", Ct);
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        Assert.Equal(500, (await Body(get)).GetProperty("measures").GetArrayLength());
    }

    // ---- get -----------------------------------------------------------------------------------------------

    [Fact]
    public async Task Get_returns_the_content_with_an_etag_and_honors_if_none_match()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);

        using HttpResponseMessage get = await client.GetAsync($"/api/scores/{id}", Ct);
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        Assert.Equal(etag, get.Headers.ETag!.Tag);
        Assert.Equal("Small score", (await Body(get)).GetProperty("meta").GetProperty("title").GetString());

        using HttpResponseMessage notModified = await client.SendAsync(
            WithHeader(Req(HttpMethod.Get, $"/api/scores/{id}"), "If-None-Match", etag), Ct);
        Assert.Equal(HttpStatusCode.NotModified, notModified.StatusCode);
        Assert.Empty(await notModified.Content.ReadAsByteArrayAsync(Ct));

        using HttpResponseMessage stale = await client.SendAsync(
            WithHeader(Req(HttpMethod.Get, $"/api/scores/{id}"), "If-None-Match", "\"999\""), Ct);
        Assert.Equal(HttpStatusCode.OK, stale.StatusCode);
    }

    private static string WithChords(string chordsJson, string diagramMode = "first")
    {
        JsonNode node = JsonNode.Parse(Small)!;
        node["parts"]![0]!["chordDiagrams"] = diagramMode;
        node["parts"]![0]!["staves"]![0]!["measures"]![0]!["chords"] = JsonNode.Parse(chordsJson);
        return node.ToJsonString();
    }

    [Fact]
    public async Task A_score_with_chord_symbols_is_stored_and_returned_as_it_was_sent()
    {
        using HttpClient client = await SignedInAsync();
        const string chords =
            "[{\"id\":\"c1\",\"tick\":0,\"root\":{\"step\":\"B\",\"alter\":-1},\"quality\":\"maj7\",\"bass\":{\"step\":\"D\",\"alter\":0}}," +
            "{\"id\":\"c2\",\"tick\":1920,\"root\":{\"step\":\"F\",\"alter\":1},\"quality\":\"m7b5\",\"diagram\":true," +
            "\"frame\":{\"frets\":[1,1,2,3,3,1],\"base\":1,\"barre\":{\"fret\":1,\"from\":1,\"to\":6}}}]";
        (Guid id, _) = await CreateAsync(client, WithChords(chords));

        using HttpResponseMessage get = await client.GetAsync($"/api/scores/{id}", Ct);
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        JsonElement body = await Body(get);
        Assert.Equal("first", body.GetProperty("parts")[0].GetProperty("chordDiagrams").GetString());
        JsonElement stored = body.GetProperty("parts")[0].GetProperty("staves")[0].GetProperty("measures")[0].GetProperty("chords");
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(stored.GetRawText()), JsonNode.Parse(chords)), stored.GetRawText());
    }

    [Theory]
    [InlineData("[{\"id\":\"c1\",\"tick\":-1,\"root\":{\"step\":\"A\",\"alter\":0},\"quality\":\"m\"}]")]
    [InlineData("[{\"id\":\"c1\",\"tick\":0,\"root\":{\"step\":\"H\",\"alter\":0},\"quality\":\"m\"}]")]
    [InlineData("[{\"id\":\"c1\",\"tick\":0,\"root\":{\"step\":\"A\",\"alter\":0},\"quality\":\"<script>\"}]")]
    [InlineData("[{\"id\":\"c1\",\"tick\":0,\"root\":{\"step\":\"A\",\"alter\":0},\"quality\":\"m\",\"frame\":{\"frets\":[],\"base\":1}}]")]
    [InlineData("[{\"id\":\"c1\",\"tick\":0,\"root\":{\"step\":\"A\",\"alter\":0},\"quality\":\"m\",\"extra\":1}]")]
    public async Task Create_rejects_malformed_chord_symbols_with_400(string chords)
    {
        using HttpClient client = await SignedInAsync();
        using HttpResponseMessage response = await client.PostAsync("/api/scores", Json(WithChords(chords)), Ct);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_an_unknown_chord_diagram_mode_and_too_many_chords_with_400()
    {
        using HttpClient client = await SignedInAsync();
        using HttpResponseMessage mode = await client.PostAsync("/api/scores", Json(WithChords("[]", "none")), Ct);
        Assert.Equal(HttpStatusCode.BadRequest, mode.StatusCode);

        string one = "{\"id\":\"c{0}\",\"tick\":{0},\"root\":{\"step\":\"A\",\"alter\":0},\"quality\":\"m\"}";
        string many = "[" + string.Join(",", Enumerable.Range(0, 33).Select(i => one.Replace("{0}", i.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal))) + "]";
        using HttpResponseMessage tooMany = await client.PostAsync("/api/scores", Json(WithChords(many)), Ct);
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
    }

    [Fact]
    public async Task Get_of_another_users_score_or_an_unknown_id_is_404_never_403()
    {
        using HttpClient owner = await SignedInAsync();
        using HttpClient other = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(owner);

        using HttpResponseMessage foreign = await other.GetAsync($"/api/scores/{id}", Ct);
        using HttpResponseMessage foreignConditional = await other.SendAsync(
            WithHeader(Req(HttpMethod.Get, $"/api/scores/{id}"), "If-None-Match", etag), Ct);
        using HttpResponseMessage unknown = await other.GetAsync($"/api/scores/{Guid.NewGuid()}", Ct);

        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, foreignConditional.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(
            await unknown.Content.ReadAsStringAsync(Ct) is { Length: > 0 },
            await foreign.Content.ReadAsStringAsync(Ct) is { Length: > 0 });
    }

    [Fact]
    public async Task Get_is_compressed_when_the_client_accepts_it()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, _) = await CreateAsync(client, Big);
        using HttpRequestMessage request = WithHeader(Req(HttpMethod.Get, $"/api/scores/{id}"), "Accept-Encoding", "gzip");
        using HttpResponseMessage response = await client.SendAsync(request, Ct);
        Assert.Contains("gzip", response.Content.Headers.ContentEncoding);
    }

    // ---- list ----------------------------------------------------------------------------------------------

    [Fact]
    public async Task List_is_paged_sorted_by_last_change_scoped_to_the_owner_and_has_no_content()
    {
        using HttpClient client = await SignedInAsync();
        using HttpClient other = await SignedInAsync();
        await CreateAsync(other, WithTitle("Not mine"));
        await CreateAsync(client, WithTitle("First"));
        await CreateAsync(client, WithTitle("Second"));
        (Guid third, string etag) = await CreateAsync(client, WithTitle("Third"));

        // Touch "First": it must come first.
        JsonElement all = await Body(await client.GetAsync("/api/scores", Ct));
        Guid first = all.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("title").GetString() == "First").GetProperty("id").GetGuid();
        using HttpResponseMessage renamed = await client.SendAsync(
            Req(HttpMethod.Patch, $"/api/scores/{first}", JsonContent.Create(new { title = "First!" }), "\"1\""), Ct);
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);

        JsonElement page = await Body(await client.GetAsync("/api/scores?pageSize=2", Ct));
        Assert.Equal(3, page.GetProperty("total").GetInt32());
        Assert.Equal(2, page.GetProperty("items").GetArrayLength());
        Assert.Equal("First!", page.GetProperty("items")[0].GetProperty("title").GetString());
        Assert.False(page.GetProperty("items")[0].TryGetProperty("content", out _));

        JsonElement page2 = await Body(await client.GetAsync("/api/scores?pageSize=2&page=2", Ct));
        Assert.Equal(1, page2.GetProperty("items").GetArrayLength());
        Assert.NotEqual(third, Guid.Empty);
        Assert.NotNull(etag);

        string raw = await client.GetStringAsync("/api/scores", Ct);
        Assert.DoesNotContain("measures", raw, StringComparison.Ordinal);
        Assert.DoesNotContain("Not mine", raw, StringComparison.Ordinal);
    }

    [Fact]
    public async Task List_returns_a_cheap_preview_with_the_measure_count_and_the_instruments()
    {
        using HttpClient client = await SignedInAsync();
        await CreateAsync(client, WithTitle("Preview me"));

        JsonElement page = await Body(await client.GetAsync("/api/scores", Ct));
        JsonElement item = page.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("title").GetString() == "Preview me");
        Assert.Equal(4, item.GetProperty("measureCount").GetInt32());
        Assert.Equal(["piano", "violin", "cello"], item.GetProperty("instruments").EnumerateArray().Select(e => e.GetString()).ToArray());
        Assert.False(item.TryGetProperty("content", out _));
    }

    [Fact]
    public async Task List_searches_titles_case_insensitively_and_treats_wildcards_literally()
    {
        using HttpClient client = await SignedInAsync();
        await CreateAsync(client, WithTitle("Moonlight Sonata"));
        await CreateAsync(client, WithTitle("100% Jazz"));
        await CreateAsync(client, WithTitle("Etude"));

        JsonElement moon = await Body(await client.GetAsync("/api/scores?q=MOONLIGHT", Ct));
        JsonElement percent = await Body(await client.GetAsync("/api/scores?q=" + Uri.EscapeDataString("%"), Ct));
        JsonElement underscore = await Body(await client.GetAsync("/api/scores?q=_", Ct));

        Assert.Equal(1, moon.GetProperty("total").GetInt32());
        Assert.Equal(1, percent.GetProperty("total").GetInt32());
        Assert.Equal(0, underscore.GetProperty("total").GetInt32());
    }

    [Theory]
    [InlineData("page=0")]
    [InlineData("pageSize=0")]
    [InlineData("pageSize=101")]
    [InlineData("page=abc")]
    public async Task List_rejects_bad_paging_with_400(string query)
    {
        using HttpClient client = await SignedInAsync();
        using HttpResponseMessage response = await client.GetAsync("/api/scores?" + query, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ---- update --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Update_requires_if_match_and_rejects_a_malformed_one()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, _) = await CreateAsync(client);

        using HttpResponseMessage missing = await client.PutAsync($"/api/scores/{id}", Json(Small), Ct);
        using HttpResponseMessage malformed = await client.SendAsync(Req(HttpMethod.Put, $"/api/scores/{id}", Json(Small), "abc"), Ct);
        using HttpResponseMessage star = await client.SendAsync(Req(HttpMethod.Put, $"/api/scores/{id}", Json(Small), "*"), Ct);

        Assert.Equal(HttpStatusCode.PreconditionRequired, missing.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, star.StatusCode);
    }

    [Fact]
    public async Task Update_replaces_the_content_bumps_the_version_and_syncs_the_title()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);

        using HttpResponseMessage updated = await client.SendAsync(
            Req(HttpMethod.Put, $"/api/scores/{id}", Json(WithTitle("Edited")), etag), Ct);
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.Equal("\"2\"", updated.Headers.ETag!.Tag);
        Assert.Equal("Edited", (await Body(updated)).GetProperty("title").GetString());

        using HttpResponseMessage get = await client.GetAsync($"/api/scores/{id}", Ct);
        Assert.Equal("Edited", (await Body(get)).GetProperty("meta").GetProperty("title").GetString());
        Assert.Equal("\"2\"", get.Headers.ETag!.Tag);
    }

    [Fact]
    public async Task Update_with_a_stale_version_is_409()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);
        using HttpResponseMessage first = await client.SendAsync(Req(HttpMethod.Put, $"/api/scores/{id}", Json(Small), etag), Ct);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        using HttpResponseMessage stale = await client.SendAsync(Req(HttpMethod.Put, $"/api/scores/{id}", Json(Small), etag), Ct);

        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("application/problem+json", stale.Content.Headers.ContentType!.MediaType);
    }

    [Fact]
    public async Task Concurrent_updates_with_the_same_version_let_exactly_one_win()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);

        HttpResponseMessage[] results = await Task.WhenAll(Enumerable.Range(0, 6).Select(i =>
            client.SendAsync(Req(HttpMethod.Put, $"/api/scores/{id}", Json(WithTitle("race " + i)), etag), Ct)));

        Assert.Single(results, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Equal(5, results.Count(r => r.StatusCode is HttpStatusCode.Conflict or HttpStatusCode.TooManyRequests));
        foreach (HttpResponseMessage r in results)
        {
            r.Dispose();
        }
    }

    [Fact]
    public async Task Update_validates_the_content_and_the_size()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);

        using HttpResponseMessage invalid = await client.SendAsync(Req(HttpMethod.Put, $"/api/scores/{id}", Json("{}"), etag), Ct);
        string huge = "{\"pad\":\"" + new string('x', ScoreLimits.MaxContentBytes) + "\"}";
        using HttpResponseMessage tooBig = await client.SendAsync(Req(HttpMethod.Put, $"/api/scores/{id}", Json(huge), etag), Ct);

        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, tooBig.StatusCode);
    }

    [Fact]
    public async Task Update_of_another_users_score_is_404_and_leaves_it_untouched()
    {
        using HttpClient owner = await SignedInAsync();
        using HttpClient other = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(owner);

        using HttpResponseMessage response = await other.SendAsync(
            Req(HttpMethod.Put, $"/api/scores/{id}", Json(WithTitle("Hijacked")), etag), Ct);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        using HttpResponseMessage get = await owner.GetAsync($"/api/scores/{id}", Ct);
        Assert.Equal("Small score", (await Body(get)).GetProperty("meta").GetProperty("title").GetString());
        Assert.Equal(etag, get.Headers.ETag!.Tag);
    }

    // ---- rename --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Rename_changes_the_title_in_the_row_and_in_the_content()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);

        using HttpResponseMessage response = await client.SendAsync(
            Req(HttpMethod.Patch, $"/api/scores/{id}", JsonContent.Create(new { title = "  Renamed " }), etag), Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("\"2\"", response.Headers.ETag!.Tag);
        Assert.Equal("Renamed", (await Body(response)).GetProperty("title").GetString());
        using HttpResponseMessage get = await client.GetAsync($"/api/scores/{id}", Ct);
        Assert.Equal("Renamed", (await Body(get)).GetProperty("meta").GetProperty("title").GetString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("bad\u0001title")]
    public async Task Rename_rejects_invalid_titles_with_400(string title)
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);
        using HttpResponseMessage response = await client.SendAsync(
            Req(HttpMethod.Patch, $"/api/scores/{id}", JsonContent.Create(new { title }), etag), Ct);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rename_needs_a_current_version_and_hides_other_users_scores()
    {
        using HttpClient owner = await SignedInAsync();
        using HttpClient other = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(owner);

        using HttpResponseMessage noHeader = await owner.PatchAsync($"/api/scores/{id}", JsonContent.Create(new { title = "x" }), Ct);
        using HttpResponseMessage stale = await owner.SendAsync(
            Req(HttpMethod.Patch, $"/api/scores/{id}", JsonContent.Create(new { title = "x" }), "\"7\""), Ct);
        using HttpResponseMessage foreign = await other.SendAsync(
            Req(HttpMethod.Patch, $"/api/scores/{id}", JsonContent.Create(new { title = "x" }), etag), Ct);

        Assert.Equal(HttpStatusCode.PreconditionRequired, noHeader.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
    }

    // ---- duplicate -----------------------------------------------------------------------------------------

    [Fact]
    public async Task Duplicate_creates_an_independent_copy()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, _) = await CreateAsync(client);

        using HttpResponseMessage response = await client.PostAsync($"/api/scores/{id}/duplicate", null, Ct);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        JsonElement copy = await Body(response);
        Guid copyId = copy.GetProperty("id").GetGuid();
        Assert.NotEqual(id, copyId);
        Assert.Equal("Small score (copy)", copy.GetProperty("title").GetString());
        Assert.Equal("\"1\"", response.Headers.ETag!.Tag);
        using HttpResponseMessage get = await client.GetAsync($"/api/scores/{copyId}", Ct);
        Assert.Equal("Small score (copy)", (await Body(get)).GetProperty("meta").GetProperty("title").GetString());
        Assert.Equal(2, (await Body(await client.GetAsync("/api/scores", Ct))).GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task Duplicate_of_another_users_score_is_404()
    {
        using HttpClient owner = await SignedInAsync();
        using HttpClient other = await SignedInAsync();
        (Guid id, _) = await CreateAsync(owner);

        using HttpResponseMessage response = await other.PostAsync($"/api/scores/{id}/duplicate", null, Ct);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(0, (await Body(await other.GetAsync("/api/scores", Ct))).GetProperty("total").GetInt32());
    }

    // ---- delete --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Delete_removes_the_score()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, _) = await CreateAsync(client);

        using HttpResponseMessage deleted = await client.DeleteAsync($"/api/scores/{id}", Ct);
        using HttpResponseMessage again = await client.DeleteAsync($"/api/scores/{id}", Ct);
        using HttpResponseMessage get = await client.GetAsync($"/api/scores/{id}", Ct);

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, again.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    [Fact]
    public async Task Delete_of_another_users_score_is_404_and_keeps_it()
    {
        using HttpClient owner = await SignedInAsync();
        using HttpClient other = await SignedInAsync();
        (Guid id, _) = await CreateAsync(owner);

        using HttpResponseMessage response = await other.DeleteAsync($"/api/scores/{id}", Ct);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        using HttpResponseMessage get = await owner.GetAsync($"/api/scores/{id}", Ct);
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
    }

    // ---- rate limit, quota, OpenAPI ------------------------------------------------------------------------

    [Fact]
    public async Task Writes_are_rate_limited_per_user_with_429_and_retry_after()
    {
        fixture.Postgres.SkipIfUnavailable();
        using var app = new TestApp(
            connectionString: fixture.Postgres.ConnectionString,
            settings: new() { ["RateLimiting:ScoreWrites:PermitLimit"] = "3", ["RateLimiting:ScoreWrites:WindowSeconds"] = "60" });
        using HttpClient limited = await ScoreTestClients.SignInAsync(app);
        using HttpClient another = await ScoreTestClients.SignInAsync(app);

        for (int i = 0; i < 3; i++)
        {
            using HttpResponseMessage ok = await limited.PostAsync("/api/scores", Json(Small), Ct);
            Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
        }

        using HttpResponseMessage blocked = await limited.PostAsync("/api/scores", Json(Small), Ct);
        using HttpResponseMessage read = await limited.GetAsync("/api/scores", Ct);
        using HttpResponseMessage otherUser = await another.PostAsync("/api/scores", Json(Small), Ct);

        Assert.Equal(HttpStatusCode.TooManyRequests, blocked.StatusCode);
        Assert.True(int.Parse(blocked.Headers.RetryAfter!.Delta!.Value.TotalSeconds.ToString("0"), System.Globalization.CultureInfo.InvariantCulture) >= 1);
        Assert.Equal("application/problem+json", blocked.Content.Headers.ContentType!.MediaType);
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        Assert.Equal(HttpStatusCode.Created, otherUser.StatusCode);
    }

    [Fact]
    public async Task The_per_user_score_quota_applies_to_create_and_duplicate()
    {
        fixture.Postgres.SkipIfUnavailable();
        using var app = new TestApp(
            connectionString: fixture.Postgres.ConnectionString,
            settings: new() { ["Scores:MaxScoresPerUser"] = "2" });
        using HttpClient client = await ScoreTestClients.SignInAsync(app);

        (Guid id, _) = await CreateAsync(client);
        await CreateAsync(client);
        using HttpResponseMessage create = await client.PostAsync("/api/scores", Json(Small), Ct);
        using HttpResponseMessage duplicate = await client.PostAsync($"/api/scores/{id}/duplicate", null, Ct);

        Assert.Equal(HttpStatusCode.Conflict, create.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        Assert.Contains("score-limit", await create.Content.ReadAsStringAsync(Ct), StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_openapi_document_exists_in_development_only()
    {
        using var dev = new TestApp(environment: "Development");
        using var prod = new TestApp();
        using HttpClient devClient = dev.CreateSecureClient();
        using HttpClient prodClient = prod.CreateSecureClient();

        using HttpResponseMessage inDev = await devClient.GetAsync("/openapi/v1.json", Ct);
        using HttpResponseMessage inProd = await prodClient.GetAsync("/openapi/v1.json", Ct);

        Assert.Equal(HttpStatusCode.OK, inDev.StatusCode);
        Assert.Contains("/api/scores", await inDev.Content.ReadAsStringAsync(Ct), StringComparison.Ordinal);
        Assert.NotEqual(HttpStatusCode.OK, inProd.StatusCode);
    }

    [Fact]
    public async Task The_migration_creates_the_expected_indexes()
    {
        fixture.Postgres.SkipIfUnavailable();
        using IServiceScope scope = fixture.App.Services.CreateScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        List<string> indexes = await db.Database
            .SqlQuery<string>($"SELECT indexname AS \"Value\" FROM pg_indexes WHERE tablename = 'scores'")
            .ToListAsync(Ct);
        Assert.Contains("ix_scores_owner_id_updated_at", indexes);
        Assert.Contains("ix_scores_title_trgm", indexes);
    }

    private static HttpRequestMessage WithHeader(HttpRequestMessage request, string name, string value)
    {
        request.Headers.TryAddWithoutValidation(name, value);
        return request;
    }
}

public sealed class ScoreTitleTests
{
    [Theory]
    [InlineData("  Hello  ", "Hello")]
    [InlineData("Étude n°1 \U0001F3B5", "Étude n°1 \U0001F3B5")]
    [InlineData("", "")]
    public void Valid_titles_are_trimmed(string input, string expected) =>
        Assert.Equal(expected, ScoreTitle.TrySanitize(input));

    [Theory]
    [InlineData("a\nb")]
    [InlineData("a\0b")]
    [InlineData("a‮b")]
    [InlineData("a\uD800b")]
    public void Control_bidi_and_broken_titles_are_refused(string input) =>
        Assert.Null(ScoreTitle.TrySanitize(input));

    [Fact]
    public void Length_is_counted_in_code_points()
    {
        Assert.NotNull(ScoreTitle.TrySanitize(string.Concat(Enumerable.Repeat("\U0001F3B5", 200))));
        Assert.Null(ScoreTitle.TrySanitize(string.Concat(Enumerable.Repeat("\U0001F3B5", 201))));
        Assert.Null(ScoreTitle.TrySanitize(null));
    }

    [Fact]
    public void A_copy_title_stays_valid_even_for_a_maximal_title()
    {
        string copy = ScoreTitle.ForCopy(new string('a', 200));
        Assert.EndsWith(" (copy)", copy, StringComparison.Ordinal);
        Assert.NotNull(ScoreTitle.TrySanitize(copy));
    }
}
