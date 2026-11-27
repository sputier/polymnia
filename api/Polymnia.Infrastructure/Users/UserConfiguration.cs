using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Polymnia.Core.Users;

namespace Polymnia.Infrastructure.Users;

internal sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable("users");
        builder.HasKey(u => u.Id);
        builder.Property(u => u.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(u => u.GoogleSubject).HasColumnName("google_subject").HasMaxLength(User.MaxSubjectLength).IsRequired();
        builder.Property(u => u.DisplayName).HasColumnName("display_name").HasMaxLength(User.MaxDisplayNameLength).IsRequired();
        builder.Property(u => u.AvatarUrl).HasColumnName("avatar_url").HasMaxLength(User.MaxAvatarUrlLength);
        builder.Property(u => u.PreferredLanguage).HasColumnName("preferred_language").HasMaxLength(User.MaxLanguageLength);
        builder.Property(u => u.CreatedAt).HasColumnName("created_at");
        builder.Property(u => u.LastSeenAt).HasColumnName("last_seen_at");
        builder.HasIndex(u => u.GoogleSubject).IsUnique().HasDatabaseName("ux_users_google_subject");
    }
}
