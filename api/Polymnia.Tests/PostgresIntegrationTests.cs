using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Polymnia.Infrastructure;

namespace Polymnia.Tests;

/// <summary>Needs Docker (Testcontainers). Skipped with an explicit reason when it is missing.</summary>
public sealed class PostgresIntegrationTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task Readiness_is_healthy_with_a_real_database_and_has_security_headers()
    {
        postgres.SkipIfUnavailable();
        using var app = new TestApp(connectionString: postgres.ConnectionString);
        using HttpClient client = app.CreateSecureClient();

        using HttpResponseMessage ready = await client.GetAsync("/api/health/ready", TestContext.Current.CancellationToken);
        using HttpResponseMessage live = await client.GetAsync("/api/health", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, ready.StatusCode);
        Assert.Equal("Healthy", await ready.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        Assert.True(live.Headers.Contains("Content-Security-Policy"));
        Assert.True(live.Headers.Contains("X-Content-Type-Options"));
        Assert.True(live.Headers.Contains("Strict-Transport-Security"));
    }

    [Fact]
    public async Task Migrations_apply_to_an_empty_database()
    {
        postgres.SkipIfUnavailable();
        using var app = new TestApp(connectionString: postgres.ConnectionString);
        using IServiceScope scope = app.Services.CreateScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();

        // Guard: a machine-level secret or environment variable must never redirect the test to another database.
        Assert.Equal(postgres.ConnectionString, db.Database.GetConnectionString());

        await db.Database.MigrateAsync(TestContext.Current.CancellationToken);

        Assert.Empty(await db.Database.GetPendingMigrationsAsync(TestContext.Current.CancellationToken));
        Assert.NotEmpty(await db.Database.GetAppliedMigrationsAsync(TestContext.Current.CancellationToken));
    }
}
