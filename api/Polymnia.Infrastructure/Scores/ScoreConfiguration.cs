using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Polymnia.Core.Scores;
using Polymnia.Core.Users;

namespace Polymnia.Infrastructure.Scores;

internal sealed class ScoreConfiguration : IEntityTypeConfiguration<Score>
{
    public void Configure(EntityTypeBuilder<Score> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable("scores", table =>
        {
            table.HasCheckConstraint("ck_scores_content_object", "jsonb_typeof(content) = 'object'");
            table.HasCheckConstraint("ck_scores_version_positive", "version > 0");
        });
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).HasColumnName("id").ValueGeneratedNever();

        // A score belongs to a user; deleting the user deletes their scores.
        builder.HasOne<User>().WithMany().HasForeignKey(s => s.OwnerId).OnDelete(DeleteBehavior.Cascade);
        builder.Property(s => s.OwnerId).HasColumnName("owner_id");
        builder.Property(s => s.Title).HasColumnName("title").HasMaxLength(ScoreLimits.MaxTitleColumnLength).IsRequired();
        builder.Property(s => s.Content).HasColumnName("content").HasColumnType("jsonb").IsRequired();
        builder.Property(s => s.SchemaVersion).HasColumnName("schema_version");
        builder.Property(s => s.Version).HasColumnName("version").IsConcurrencyToken();
        builder.Property(s => s.CreatedAt).HasColumnName("created_at");
        builder.Property(s => s.UpdatedAt).HasColumnName("updated_at");

        // List: every query is filtered by owner and sorted by most recent change.
        builder.HasIndex(s => new { s.OwnerId, s.UpdatedAt }, "ix_scores_owner_id_updated_at")
            .IsDescending(false, true);

        // Title search (ILIKE '%text%'): a B-tree cannot serve a leading wildcard, a trigram GIN index can.
        builder.HasIndex(s => s.Title, "ix_scores_title_trgm")
            .HasMethod("gin")
            .HasOperators("gin_trgm_ops");
    }
}
