using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Polymnia.Core.Users;

namespace Polymnia.Infrastructure.Sessions;

/// <summary>
/// Server-side session. The browser only holds an opaque random key; the row is found by the SHA-256 hash
/// of that key, so a database leak does not reveal usable session ids. The serialized ticket is encrypted.
/// Deleting the row (logout) or the user (cascade) ends the session immediately.
/// </summary>
public sealed class UserSession
{
    public const int KeyHashLength = 64;

    /// <summary>Hex SHA-256 of the session key.</summary>
    public required string KeyHash { get; set; }

    public Guid UserId { get; set; }

    /// <summary>Data-protected authentication ticket.</summary>
    public required byte[] Ticket { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Sliding expiration, moved forward while the session is used.</summary>
    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>Hard limit that sliding renewal can never extend.</summary>
    public DateTimeOffset AbsoluteExpiresAt { get; set; }
}

internal sealed class UserSessionConfiguration : IEntityTypeConfiguration<UserSession>
{
    public void Configure(EntityTypeBuilder<UserSession> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable("user_sessions");
        builder.HasKey(s => s.KeyHash);
        builder.Property(s => s.KeyHash).HasColumnName("key_hash").HasMaxLength(UserSession.KeyHashLength).IsFixedLength();
        builder.Property(s => s.UserId).HasColumnName("user_id");
        builder.Property(s => s.Ticket).HasColumnName("ticket").IsRequired();
        builder.Property(s => s.CreatedAt).HasColumnName("created_at");
        builder.Property(s => s.ExpiresAt).HasColumnName("expires_at");
        builder.Property(s => s.AbsoluteExpiresAt).HasColumnName("absolute_expires_at");
        builder.HasOne<User>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(s => s.UserId).HasDatabaseName("ix_user_sessions_user_id");
        builder.HasIndex(s => s.ExpiresAt).HasDatabaseName("ix_user_sessions_expires_at");
    }
}
