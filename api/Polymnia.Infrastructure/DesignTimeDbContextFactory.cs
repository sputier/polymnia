using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Polymnia.Infrastructure;

/// <summary>
/// Used by <c>dotnet ef</c> only. Reads <c>ConnectionStrings__Polymnia</c> from the environment;
/// generating a migration does not connect, so a placeholder without credentials is used when unset.
/// </summary>
internal sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<PolymniaDbContext>
{
    public PolymniaDbContext CreateDbContext(string[] args)
    {
        string connectionString =
            Environment.GetEnvironmentVariable("ConnectionStrings__Polymnia")
            ?? "Host=localhost;Database=polymnia_design_time";

        DbContextOptions<PolymniaDbContext> options = new DbContextOptionsBuilder<PolymniaDbContext>()
            .UseNpgsql(connectionString)
            .Options;
        return new PolymniaDbContext(options);
    }
}
