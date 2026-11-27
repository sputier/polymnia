using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Polymnia.Infrastructure;

namespace Polymnia.Tests;

public sealed class InfrastructureTests
{
    [Fact]
    public void Missing_connection_string_fails_fast_with_a_safe_message()
    {
        IConfiguration configuration = new ConfigurationBuilder().Build();

        var ex = Assert.Throws<InvalidOperationException>(() => new ServiceCollection().AddInfrastructure(configuration));

        Assert.Contains("ConnectionStrings:Polymnia", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Connection_string_comes_from_configuration()
    {
        IConfiguration configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Polymnia"] = TestApp.UnreachableConnectionString,
            })
            .Build();
        var services = new ServiceCollection();
        services.AddInfrastructure(configuration);

        using ServiceProvider provider = services.BuildServiceProvider();
        using IServiceScope scope = provider.CreateScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();

        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", db.Database.ProviderName);
    }

    [Fact]
    public void Migrations_match_the_model_snapshot()
    {
        // Offline check (no connection needed): fails when the model changed without a new migration.
        DbContextOptions<PolymniaDbContext> options = new DbContextOptionsBuilder<PolymniaDbContext>()
            .UseNpgsql(TestApp.UnreachableConnectionString)
            .Options;
        using var db = new PolymniaDbContext(options);

        Assert.NotEmpty(db.Database.GetMigrations());
        Assert.False(db.Database.HasPendingModelChanges());
    }
}
