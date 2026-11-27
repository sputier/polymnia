using System.Net;

namespace Polymnia.Tests;

public sealed class HealthTests : IDisposable
{
    private readonly TestApp _app = new();

    public void Dispose() => _app.Dispose();

    [Fact]
    public async Task Liveness_returns_200_without_touching_the_database()
    {
        // The connection string points at a closed port: liveness must not care.
        using HttpClient client = _app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync("/api/health", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.True(response.Headers.CacheControl?.NoStore);
    }

    [Fact]
    public async Task Readiness_reports_unhealthy_without_leaking_connection_details()
    {
        using HttpClient client = _app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync("/api/health/ready", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        string body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        Assert.Equal("Unhealthy", body);
    }

    [Fact]
    public async Task Health_endpoints_reject_unsafe_methods()
    {
        using HttpClient client = _app.CreateSecureClient();

        using HttpResponseMessage response = await client.PostAsync("/api/health", content: null, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Health_endpoints_are_not_redirected_to_https()
    {
        using HttpClient client = _app.CreateClient(new()
        {
            BaseAddress = new Uri("http://polymnia.example"),
            AllowAutoRedirect = false,
        });

        using HttpResponseMessage response = await client.GetAsync("/api/health", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
