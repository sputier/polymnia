using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Polymnia.Core.Users;

namespace Polymnia.Infrastructure.Users;

internal sealed class RegistrationEventConfiguration : IEntityTypeConfiguration<RegistrationEvent>
{
    public void Configure(EntityTypeBuilder<RegistrationEvent> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable("registration_events");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).HasColumnName("id").ValueGeneratedOnAdd();
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.HasIndex(e => e.CreatedAt, "ix_registration_events_created_at");
    }
}
