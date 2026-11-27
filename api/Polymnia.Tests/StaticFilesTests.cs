using System.Net;
using System.Text.Json;

namespace Polymnia.Tests;

public sealed class StaticFilesTests : IDisposable
{
    private readonly TestApp _app = new();

    public void Dispose() => _app.Dispose();

    [Fact]
    public async Task Hashed_assets_are_cached_forever()
    {
        using HttpClient client = _app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync("/assets/index-4f9a1c2b.js", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("public, max-age=31536000, immutable", response.Headers.CacheControl?.ToString());
        Assert.Equal(TestApp.AssetBody, await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/index.html")]
    public async Task Index_html_must_be_revalidated(string path)
    {
        using HttpClient client = _app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync(path, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-cache", response.Headers.CacheControl?.ToString());
        Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(TestApp.IndexHtml, await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Other_static_files_are_revalidated()
    {
        using HttpClient client = _app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync("/favicon.svg", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-cache", response.Headers.CacheControl?.ToString());
    }

    [Theory]
    [InlineData("/scores/42")]
    [InlineData("/s/abc-share-link")]
    [InlineData("/library")]
    public async Task Client_side_routes_fall_back_to_index_html(string path)
    {
        using HttpClient client = _app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync(path, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-cache", response.Headers.CacheControl?.ToString());
        Assert.Equal(TestApp.IndexHtml, await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
    }

    [Theory]
    [InlineData("/assets/missing.js")]
    [InlineData("/robots.txt")]
    public async Task Missing_files_are_404_not_the_spa(string path)
    {
        using HttpClient client = _app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync(path, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.DoesNotContain("<html", await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Non_get_requests_do_not_receive_the_spa()
    {
        using HttpClient client = _app.CreateSecureClient();

        using HttpResponseMessage response = await client.PostAsync("/scores/42", content: null, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
    }

    [Theory]
    [InlineData("/api/does-not-exist")]
    [InlineData("/api/scores/1/deep/path")]
    [InlineData("/API/anything")]
    [InlineData("/api")]
    public async Task Unknown_api_routes_return_problem_details_not_the_spa(string path)
    {
        using HttpClient client = _app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync(path, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using JsonDocument json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(404, json.RootElement.GetProperty("status").GetInt32());
    }

    [Fact]
    public async Task Spa_fallback_supports_conditional_requests()
    {
        using HttpClient client = _app.CreateSecureClient();
        using HttpResponseMessage first = await client.GetAsync("/library", TestContext.Current.CancellationToken);
        Assert.NotNull(first.Headers.ETag);

        using var request = new HttpRequestMessage(HttpMethod.Get, "/library");
        request.Headers.IfNoneMatch.Add(first.Headers.ETag);
        using HttpResponseMessage second = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotModified, second.StatusCode);
    }

    [Fact]
    public async Task Api_responses_are_not_cacheable_by_default()
    {
        using HttpClient client = _app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync("/api/does-not-exist", TestContext.Current.CancellationToken);

        Assert.True(response.Headers.CacheControl?.NoStore);
    }

    [Fact]
    public async Task Static_responses_are_compressed_with_brotli_when_accepted()
    {
        using HttpClient client = _app.CreateSecureClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/assets/index-4f9a1c2b.js");
        request.Headers.AcceptEncoding.ParseAdd("br, gzip");

        using HttpResponseMessage response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("br", response.Content.Headers.ContentEncoding);
    }

    [Fact]
    public async Task Static_responses_fall_back_to_gzip()
    {
        using HttpClient client = _app.CreateSecureClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/");
        request.Headers.AcceptEncoding.ParseAdd("gzip");

        using HttpResponseMessage response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("gzip", response.Content.Headers.ContentEncoding);
    }

    [Fact]
    public async Task Missing_web_root_index_returns_404_problem_details()
    {
        using var app = new TestApp();
        File.Delete(Path.Combine(AppRoot(app), "index.html"));
        using HttpClient client = app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync("/", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    private static string AppRoot(TestApp app) =>
        app.Services.GetService(typeof(Microsoft.AspNetCore.Hosting.IWebHostEnvironment)) is Microsoft.AspNetCore.Hosting.IWebHostEnvironment env
            ? env.WebRootPath
            : throw new InvalidOperationException("No web host environment.");
}
