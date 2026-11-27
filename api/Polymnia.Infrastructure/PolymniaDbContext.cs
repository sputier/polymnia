using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Polymnia.Core.Users;
using Polymnia.Infrastructure.Sessions;
using Polymnia.Core.Scores;

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
    public DbSet<Score> Scores => Set<Score>();

    public DbSet<Polymnia.Core.Sharing.ShareLink> ShareLinks => Set<Polymnia.Core.Sharing.ShareLink>();

    public DbSet<Polymnia.Core.Contact.ContactMessage> ContactMessages => Set<Polymnia.Core.Contact.ContactMessage>();

    public DbSet<RegistrationEvent> RegistrationEvents => Set<RegistrationEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ArgumentNullException.ThrowIfNull(modelBuilder);
        modelBuilder.HasPostgresExtension("pg_trgm");
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PolymniaDbContext).Assembly);
        modelBuilder.Entity<DataProtectionKey>(key =>
        {
            key.ToTable("data_protection_keys");
            key.Property(k => k.Id).HasColumnName("id");
            key.Property(k => k.FriendlyName).HasColumnName("friendly_name");
            key.Property(k => k.Xml).HasColumnName("xml");
        });
    }
}
