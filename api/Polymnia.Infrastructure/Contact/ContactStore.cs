using Microsoft.EntityFrameworkCore;
using Polymnia.Core.Contact;

namespace Polymnia.Infrastructure.Contact;

/// <summary>
/// Storage of the contact messages and the queue the forwarder works from. The queue is the table itself: a message
/// is stored first, then claimed, sent and marked. Claims are atomic <c>UPDATE</c>s, so several instances never send
/// the same message twice.
/// </summary>
public sealed class ContactStore(PolymniaDbContext db, TimeProvider clock)
{
    /// <summary>Delivery attempts before a message is left as <see cref="ContactStatus.Failed"/>.</summary>
    public const int MaxAttempts = 8;

    /// <summary>Stores a message. <paramref name="forward"/> says whether an SMTP server will pick it up.</summary>
    public async Task<Guid> AddAsync(ContactTopic topic, string message, string? replyTo, bool forward, CancellationToken ct)
    {
        DateTimeOffset now = clock.GetUtcNow();
        ContactMessage row = new()
        {
            Id = Guid.CreateVersion7(),
            CreatedAt = now,
            Topic = topic,
            Message = message,
            ReplyTo = replyTo,
            Status = forward ? ContactStatus.Pending : ContactStatus.Stored,
            NextAttemptAt = forward ? now : null,
        };
        db.ContactMessages.Add(row);
        await db.SaveChangesAsync(ct);
        return row.Id;
    }

    /// <summary>
    /// Claims the next message that is due (pending, not locked by someone else) and returns it, or <c>null</c>.
    /// The attempt is counted when it is claimed, so a crash during the send still moves the message forward.
    /// </summary>
    public async Task<ContactMessage?> ClaimNextAsync(TimeSpan lockFor, CancellationToken ct)
    {
        DateTimeOffset now = clock.GetUtcNow();

        // A message whose attempts ran out without a recorded failure (the process died mid-send, again and again) is
        // a poison message: it is left as Failed, not retried for ever.
        await db.ContactMessages
            .Where(m => m.Status == ContactStatus.Pending && m.Attempts >= MaxAttempts && (m.LockedUntil == null || m.LockedUntil < now))
            .ExecuteUpdateAsync(set => set.SetProperty(m => m.Status, ContactStatus.Failed).SetProperty(m => m.NextAttemptAt, (DateTimeOffset?)null), ct);

        for (int i = 0; i < 5; i++)
        {
            Guid? id = await db.ContactMessages.AsNoTracking()
                .Where(m => m.Status == ContactStatus.Pending && m.NextAttemptAt <= now && (m.LockedUntil == null || m.LockedUntil < now))
                .OrderBy(m => m.NextAttemptAt)
                .Select(m => (Guid?)m.Id)
                .FirstOrDefaultAsync(ct);
            if (id is null)
            {
                return null;
            }

            // Longer than the longest send, so no other instance takes the message while it is being sent.
            DateTimeOffset until = now + lockFor;
            int claimed = await db.ContactMessages
                .Where(m => m.Id == id && m.Status == ContactStatus.Pending && (m.LockedUntil == null || m.LockedUntil < now))
                .ExecuteUpdateAsync(set => set.SetProperty(m => m.LockedUntil, until).SetProperty(m => m.Attempts, m => m.Attempts + 1), ct);
            if (claimed == 1)
            {
                return await db.ContactMessages.AsNoTracking().FirstAsync(m => m.Id == id, ct);
            }
        }

        return null;
    }

    /// <summary>Marks the message sent, only if the caller still holds its claim (same attempt, still pending).</summary>
    public async Task<bool> MarkSentAsync(Guid id, int attempts, CancellationToken ct)
    {
        DateTimeOffset now = clock.GetUtcNow();
        int rows = await db.ContactMessages.Where(m => m.Id == id && m.Status == ContactStatus.Pending && m.Attempts == attempts).ExecuteUpdateAsync(
            set => set
                .SetProperty(m => m.Status, ContactStatus.Sent)
                .SetProperty(m => m.SentAt, now)
                .SetProperty(m => m.NextAttemptAt, (DateTimeOffset?)null)
                .SetProperty(m => m.LockedUntil, (DateTimeOffset?)null)
                .SetProperty(m => m.LastError, (string?)null),
            ct);
        return rows == 1;
    }

    /// <summary>
    /// Records a failed attempt: another try with exponential backoff (1 min, 2, 4... at most 1 hour), or
    /// <see cref="ContactStatus.Failed"/> once <see cref="MaxAttempts"/> is reached. Returns the new status.
    /// </summary>
    public async Task<ContactStatus> MarkFailedAsync(Guid id, int attempts, string error, CancellationToken ct)
    {
        bool giveUp = attempts >= MaxAttempts;
        DateTimeOffset? next = giveUp ? null : clock.GetUtcNow() + Backoff(attempts);
        ContactStatus status = giveUp ? ContactStatus.Failed : ContactStatus.Pending;
        string code = error.Length > 128 ? error[..128] : error;
        // Only the holder of the claim (same attempt, still pending) may record the outcome: a late result of a slow
        // worker never overwrites what another instance has done since.
        await db.ContactMessages.Where(m => m.Id == id && m.Status == ContactStatus.Pending && m.Attempts == attempts).ExecuteUpdateAsync(
            set => set
                .SetProperty(m => m.Status, status)
                .SetProperty(m => m.NextAttemptAt, next)
                .SetProperty(m => m.LockedUntil, (DateTimeOffset?)null)
                .SetProperty(m => m.LastError, code),
            ct);
        return status;
    }

    /// <summary>Delay before attempt number <paramref name="attempts"/> + 1.</summary>
    public static TimeSpan Backoff(int attempts) =>
        TimeSpan.FromMinutes(Math.Min(60, Math.Pow(2, Math.Clamp(attempts - 1, 0, 6))));

    /// <summary>Deletes the messages older than the retention period, whatever their status. Returns how many.</summary>
    public async Task<int> PurgeAsync(TimeSpan retention, CancellationToken ct)
    {
        DateTimeOffset cutoff = clock.GetUtcNow() - retention;
        return await db.ContactMessages.Where(m => m.CreatedAt < cutoff).ExecuteDeleteAsync(ct);
    }
}
