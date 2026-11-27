using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.TestHost;
using Polymnia.Api.Hosting;

namespace Polymnia.Tests;

/// <summary>
/// BREACH mitigation rule: endpoints that return secrets are excluded from compression.
/// The host below uses the real hosting setup plus two probe endpoints.
/// </summary>
public sealed class CompressionPolicyTests : IAsyncDisposable
{
    private static readonly string Body = "{\"value\":\"" + new string('a', 2000) + "\"}";

    private readonly WebApplication _app;

    public CompressionPolicyTests()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Development" });
        builder.WebHost.UseTestServer();
        builder.Services.AddPolymniaHosting(builder.Configuration, builder.Environment);

        _app = builder.Build();
        _app.UsePolymniaPipeline();
        _app.MapGet("/probe/public", () => Results.Text(Body, "application/json"));
        _app.MapGet("/probe/secret", () => Results.Text(Body, "application/json")).DisableResponseCompression();
        _app.StartAsync(TestContext.Current.CancellationToken).GetAwaiter().GetResult();
    }

    public async ValueTask DisposeAsync() => await _app.DisposeAsync();

    [Fact]
    public async Task Regular_endpoints_are_compressed()
    {
        using HttpResponseMessage response = await GetAsync("/probe/public");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("br", response.Content.Headers.ContentEncoding);
    }

    [Fact]
    public async Task Endpoints_marked_as_secret_are_never_compressed()
    {
        using HttpResponseMessage response = await GetAsync("/probe/secret");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(response.Content.Headers.ContentEncoding);
        Assert.Equal(Body, await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
    }

    private async Task<HttpResponseMessage> GetAsync(string path)
    {
        using HttpClient client = _app.GetTestClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.AcceptEncoding.ParseAdd("br, gzip");
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }
}
