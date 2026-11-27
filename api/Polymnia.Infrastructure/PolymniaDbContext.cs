using Microsoft.EntityFrameworkCore;

namespace Polymnia.Infrastructure;

/// <summary>
/// EF Core context for Polymnia. Entities are added by later issues (users, scores).
/// Convention: read-only queries use <c>AsNoTracking()</c>.
/// </summary>
public sealed class PolymniaDbContext(DbContextOptions<PolymniaDbContext> options) : DbContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ArgumentNullException.ThrowIfNull(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PolymniaDbContext).Assembly);
    }
}
