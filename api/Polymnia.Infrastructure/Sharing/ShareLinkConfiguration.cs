using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Polymnia.Core.Scores;
using Polymnia.Core.Sharing;

namespace Polymnia.Infrastructure.Sharing;

internal sealed class ShareLinkConfiguration : IEntityTypeConfiguration<ShareLink>
{
    public void Configure(EntityTypeBuilder<ShareLink> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable("share_links", table => table.HasCheckConstraint("ck_share_links_hash_length", "octet_length(token_hash) = 32"));
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Id).HasColumnName("id").ValueGeneratedNever();
        builder.HasOne<Score>().WithMany().HasForeignKey(l => l.ScoreId).OnDelete(DeleteBehavior.Cascade);
        builder.Property(l => l.ScoreId).HasColumnName("score_id");
        builder.Property(l => l.TokenHash).HasColumnName("token_hash").HasColumnType("bytea").IsRequired();
        builder.Property(l => l.CreatedAt).HasColumnName("created_at");
        builder.Property(l => l.RevokedAt).HasColumnName("revoked_at");

        // The lookup of the public endpoint.
        builder.HasIndex(l => l.TokenHash, "ux_share_links_token_hash").IsUnique();

        // At most one active link per score, enforced by the database (two concurrent creations cannot both win).
        builder.HasIndex(l => l.ScoreId, "ux_share_links_score_id_active")
            .IsUnique()
            .HasFilter("revoked_at IS NULL");
    }
}
