using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Polymnia.Core.Contact;

namespace Polymnia.Infrastructure.Contact;

internal sealed class ContactMessageConfiguration : IEntityTypeConfiguration<ContactMessage>
{
    public void Configure(EntityTypeBuilder<ContactMessage> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable("contact_messages", table =>
        {
            table.HasCheckConstraint("ck_contact_messages_message_length", $"char_length(message) <= {ContactLimits.MaxMessageLength}");
            table.HasCheckConstraint("ck_contact_messages_reply_to_length", $"reply_to IS NULL OR char_length(reply_to) <= {ContactLimits.MaxReplyToLength}");
        });
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(m => m.CreatedAt).HasColumnName("created_at");
        builder.Property(m => m.Topic).HasColumnName("topic").HasConversion<string>().HasMaxLength(16);
        builder.Property(m => m.Message).HasColumnName("message").IsRequired();
        builder.Property(m => m.ReplyTo).HasColumnName("reply_to");
        builder.Property(m => m.Status).HasColumnName("status").HasConversion<string>().HasMaxLength(16);
        builder.Property(m => m.Attempts).HasColumnName("attempts");
        builder.Property(m => m.NextAttemptAt).HasColumnName("next_attempt_at");
        builder.Property(m => m.LockedUntil).HasColumnName("locked_until");
        builder.Property(m => m.SentAt).HasColumnName("sent_at");
        builder.Property(m => m.LastError).HasColumnName("last_error").HasMaxLength(128);

        // The forwarder looks for due pending messages; the purge looks at the age.
        builder.HasIndex(m => new { m.Status, m.NextAttemptAt }, "ix_contact_messages_status_next_attempt_at");
        builder.HasIndex(m => m.CreatedAt, "ix_contact_messages_created_at");
    }
}
