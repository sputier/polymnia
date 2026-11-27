using System.Net;

namespace Polymnia.Tests;

/// <summary>A request for a host the operator did not list never reaches the application (no redirect built from it either).</summary>
public sealed class SecurityReviewHostTests
{
    [Theory]
    [InlineData("evil.example")]
    [InlineData("polymnia.example.evil.example")]
    [InlineData("evil.example:443")]
    public async Task An_unlisted_host_header_is_refused(string host)
    {
        using var app = new TestApp();
        using HttpClient client = app.CreateSecureClient();
        foreach (string path in new[] { "/", "/api/health", "/api/auth/login", "/api/legal" })
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, path);
            request.Headers.Host = host;

            using HttpResponseMessage response = await client.SendAsync(request, TestContext.Current.CancellationToken);

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Null(response.Headers.Location);
        }
    }
}
