using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Primitives;

namespace Polymnia.Tests;

public sealed class ErrorHandlingTests
{
    private const string Secret = "TOP-SECRET-INTERNAL-DETAIL";

    [Fact]
    public async Task Unhandled_exceptions_return_problem_details_without_internals_in_production()
    {
        using var app = new TestApp(environment: "Production");
        BreakWebRoot(app);
        using HttpClient client = app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync("/library", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        string body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        Assert.DoesNotContain(Secret, body, StringComparison.Ordinal);
        Assert.DoesNotContain("InvalidOperationException", body, StringComparison.Ordinal);
        Assert.DoesNotContain(" at Polymnia", body, StringComparison.Ordinal);
        Assert.DoesNotContain("stackTrace", body, StringComparison.OrdinalIgnoreCase);
        using JsonDocument json = JsonDocument.Parse(body);
        Assert.Equal(500, json.RootElement.GetProperty("status").GetInt32());
    }

    [Fact]
    public async Task Error_responses_still_carry_the_security_headers()
    {
        using var app = new TestApp(environment: "Production");
        BreakWebRoot(app);
        using HttpClient client = app.CreateSecureClient();

        using HttpResponseMessage response = await client.GetAsync("/library", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.True(response.Headers.Contains("Content-Security-Policy"));
        Assert.True(response.Headers.Contains("X-Content-Type-Options"));
    }

    private static void BreakWebRoot(TestApp app)
    {
        // The SPA fallback reads the web root lazily on each request, so swapping the provider
        // after the host starts makes the request fail inside the real pipeline.
        app.Services.GetRequiredService<IWebHostEnvironment>().WebRootFileProvider = new ThrowingFileProvider();
    }

    private sealed class ThrowingFileProvider : IFileProvider
    {
        public IDirectoryContents GetDirectoryContents(string subpath) => throw new InvalidOperationException(Secret);

        public IFileInfo GetFileInfo(string subpath) => throw new InvalidOperationException(Secret);

        public IChangeToken Watch(string filter) => throw new InvalidOperationException(Secret);
    }
}
