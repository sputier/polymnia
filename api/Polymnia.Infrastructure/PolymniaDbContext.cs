using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Polymnia.Core.Users;
using Polymnia.Infrastructure.Sessions;

namespace Polymnia.Infrastructure;

/// <summary>
/// EF Core context for Polymnia. Convention: read-only queries use <c>AsNoTracking()</c>.
/// It also stores the ASP.NET Core Data Protection keys, so that cookies and antiforgery tokens survive
/// restarts and work across several containers.
/// </summary>
public sealed class PolymniaDbContext(DbContextOptions<PolymniaDbContext> options)
    : DbContext(options), IDataProtectionKeyContext
{
    public DbSet<User> Users => Set<User>();

    public DbSet<UserSession> Sessions => Set<UserSession>();

    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ArgumentNullException.ThrowIfNull(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PolymniaDbContext).Assembly);
        modelBuilder.Entity<DataProtectionKey>().ToTable("data_protection_keys");
    }
}
