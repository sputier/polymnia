using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Polymnia.Api.Hosting;
using Polymnia.Infrastructure;

namespace Polymnia.Tests;

public sealed class ContainerCommandsTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private sealed class StubHandler(HttpStatusCode status) : HttpMessageHandler
    {
        public HttpRequestMessage? Last { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Last = request;
            return Task.FromResult(new HttpResponseMessage(status));
        }
    }

    [Fact]
    public void Switches_are_detected_and_stripped()
    {
        string[] args = ["--migrate", "--urls=http://x"];

        Assert.True(ContainerCommands.HasSwitch(args, ContainerCommands.MigrateSwitch));
        Assert.False(ContainerCommands.HasSwitch(args, ContainerCommands.HealthCheckSwitch));
        Assert.Equal(["--urls=http://x"], ContainerCommands.StripSwitches(args));
    }

    [Theory]
    [InlineData(null, "8080")]
    [InlineData("", "8080")]
    [InlineData("9000", "9000")]
    [InlineData("9000;9001", "9000")]
    [InlineData("abc", "8080")]
    [InlineData("70000", "8080")]
    public void Port_comes_from_ASPNETCORE_HTTP_PORTS(string? value, string expected) =>
        Assert.Equal(expected, ContainerCommands.FirstPort(value));

    [Theory]
    [InlineData(null, null)]
    [InlineData("*", null)]
    [InlineData("*.example.com", null)]
    [InlineData("polymnia.example.com", "polymnia.example.com")]
    [InlineData("*.example.com;polymnia.example.com;other.example", "polymnia.example.com")]
    [InlineData("polymnia.example.com:8443", "polymnia.example.com:8443")]
    [InlineData(";;polymnia.example.com", "polymnia.example.com")]
    [InlineData("a:b:c", null)]
    [InlineData("[::1]", null)]
    public void Health_probe_uses_the_first_concrete_allowed_host(string? allowed, string? expected) =>
        Assert.Equal(expected, ContainerCommands.FirstConcreteHost(allowed));

    [Theory]
    [InlineData(HttpStatusCode.OK, 0)]
    [InlineData(HttpStatusCode.ServiceUnavailable, 1)]
    [InlineData(HttpStatusCode.BadRequest, 1)]
    public async Task Health_probe_exit_code_follows_the_response(HttpStatusCode status, int expected)
    {
        using var handler = new StubHandler(status);
        Dictionary<string, string> env = new() { ["ASPNETCORE_HTTP_PORTS"] = "8081", ["AllowedHosts"] = "polymnia.example.com" };

        int code = await ContainerCommands.HealthCheckAsync(k => env.GetValueOrDefault(k), handler, TestContext.Current.CancellationToken);

        Assert.Equal(expected, code);
        Assert.Equal("http://127.0.0.1:8081/api/health", handler.Last!.RequestUri!.ToString());
        Assert.Equal("polymnia.example.com", handler.Last.Headers.Host);
    }

    [Fact]
    public async Task Health_probe_fails_when_nothing_listens()
    {
        Dictionary<string, string> env = new() { ["ASPNETCORE_HTTP_PORTS"] = "1" };

        Assert.Equal(1, await ContainerCommands.HealthCheckAsync(k => env.GetValueOrDefault(k), cancellationToken: TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Migrate_applies_migrations_and_is_idempotent()
    {
        postgres.SkipIfUnavailable();
        using var app = new TestApp(connectionString: postgres.ConnectionString);

        Assert.Equal(0, await ContainerCommands.MigrateAsync(app.Services, TestContext.Current.CancellationToken));
        Assert.Equal(0, await ContainerCommands.MigrateAsync(app.Services, TestContext.Current.CancellationToken));

        using IServiceScope scope = app.Services.CreateScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        Assert.Empty(await db.Database.GetPendingMigrationsAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Migrate_returns_a_failure_code_when_the_database_is_unreachable()
    {
        using var app = new TestApp();

        Assert.Equal(1, await ContainerCommands.MigrateAsync(app.Services, TestContext.Current.CancellationToken));
    }
}
