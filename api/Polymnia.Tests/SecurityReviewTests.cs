using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace Polymnia.Tests;

/// <summary>Regression tests of the pre-release security review (issue #20, docs/security-review.md).</summary>
public sealed class SecurityReviewScoreTests(ScoreApiFixture fixture) : IClassFixture<ScoreApiFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly string Small = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "score-small.json"));

    private async Task<HttpClient> SignedInAsync()
    {
        fixture.Postgres.SkipIfUnavailable();
        return await ScoreTestClients.SignInAsync(fixture.App);
    }

    private static ByteArrayContent Gzip(string json)
    {
        using MemoryStream output = new();
        using (GZipStream gzip = new(output, CompressionLevel.Fastest, leaveOpen: true))
        {
            gzip.Write(Encoding.UTF8.GetBytes(json));
        }

        ByteArrayContent content = new(output.ToArray());
        content.Headers.ContentType = new("application/json");
        content.Headers.ContentEncoding.Add("gzip");
        return content;
    }

    [Fact]
    public async Task A_compressed_body_is_refused_where_nothing_bounds_the_decompressed_size()
    {
        using HttpClient client = await SignedInAsync();
        using HttpResponseMessage created = await client.PostAsync("/api/scores", new StringContent(Small, Encoding.UTF8, "application/json"), Ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        string id = (await created.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>(Ct)).GetProperty("id").GetString()!;

        // The rename body is model-bound (not read through BoundedBody): a gzip bomb must never be inflated for it.
        string bomb = "{\"title\":\"" + new string('x', 8 * 1024 * 1024) + "\"}";
        using HttpRequestMessage rename = new(HttpMethod.Patch, $"/api/scores/{id}") { Content = Gzip(bomb) };
        rename.Headers.TryAddWithoutValidation("If-Match", created.Headers.ETag!.Tag);
        using HttpResponseMessage response = await client.SendAsync(rename, Ct);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);

        // Same for a route that reads no body at all.
        using HttpRequestMessage duplicate = new(HttpMethod.Post, $"/api/scores/{id}/duplicate") { Content = Gzip(bomb) };
        using HttpResponseMessage dup = await client.SendAsync(duplicate, Ct);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, dup.StatusCode);
    }
}

public sealed class SecurityReviewHeaderTests
{
    [Theory]
    [InlineData("/")]
    [InlineData("/api/health")]
    [InlineData("/api/nothing")]
    [InlineData("/assets/index-4f9a1c2b.js")]
    public async Task Every_response_forbids_framing_and_cross_origin_embedding(string path)
    {
        using var app = new TestApp();
        using HttpClient client = app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync(path, TestContext.Current.CancellationToken);

        Assert.Equal("DENY", Assert.Single(response.Headers.GetValues("X-Frame-Options")));
        Assert.Equal("same-origin", Assert.Single(response.Headers.GetValues("Cross-Origin-Resource-Policy")));
    }
}

/// <summary>The OpenID Connect handler listens on paths of its own: none of them may act without Google.</summary>
public sealed class SecurityReviewOidcTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Theory]
    [InlineData("GET", "/signout-oidc")]
    [InlineData("POST", "/signout-oidc")]
    public async Task The_remote_sign_out_paths_of_the_oidc_handler_cannot_end_a_session(string method, string path)
    {
        postgres.SkipIfUnavailable();
        using var app = new TestApp(connectionString: postgres.ConnectionString, fakeGoogle: false);
        await app.MigrateAsync();
        var browser = new TestBrowser(app);
        using HttpResponseMessage login = await browser.GetAsync("/api/auth/login");
        var query = QueryHelpers.ParseQuery(login.Headers.Location!.Query);
        app.Oidc.NextIdToken = app.Oidc.CreateIdToken(query["nonce"].ToString());
        using HttpResponseMessage callback = await browser.GetAsync(
            $"/api/auth/callback?code=c&state={Uri.EscapeDataString(query["state"].ToString())}");
        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);

        // A cross-site page can send the browser here with the session cookie (SameSite=Lax on a GET navigation).
        using HttpResponseMessage attack = await browser.SendAsync(new HttpMethod(method), path);
        using HttpResponseMessage me = await browser.GetAsync("/api/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        Assert.NotEqual(HttpStatusCode.OK, attack.StatusCode);
    }
}
