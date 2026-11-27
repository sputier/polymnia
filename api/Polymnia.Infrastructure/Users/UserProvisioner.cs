using Microsoft.EntityFrameworkCore;
using Npgsql;
using Polymnia.Core.Users;

namespace Polymnia.Infrastructure.Users;

/// <summary>Creates the user on first sign-in and refreshes the profile on later ones.</summary>
public sealed class UserProvisioner(PolymniaDbContext db, TimeProvider time)
{
    private const string PostgresUniqueViolation = "23505";

    /// <summary>Returns the internal id of the user for this Google subject (created if new).</summary>
    public async Task<Guid> SignInAsync(
        string googleSubject,
        string? displayName,
        string? avatarUrl,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(googleSubject);
        if (googleSubject.Length > User.MaxSubjectLength)
        {
            throw new ArgumentException("Google subject is too long.", nameof(googleSubject));
        }

        string name = Truncate(CleanName(displayName), User.MaxDisplayNameLength);
        string? avatar = SanitizeAvatarUrl(avatarUrl);
        DateTimeOffset now = time.GetUtcNow();

        // Two sign-ins of a new user can race on the unique index: the loser updates instead.
        for (int attempt = 0; attempt < 2; attempt++)
        {
            Guid? existing = await db.Users
                .Where(u => u.GoogleSubject == googleSubject)
                .Select(u => (Guid?)u.Id)
                .FirstOrDefaultAsync(cancellationToken);

            if (existing is { } id)
            {
                await db.Users
                    .Where(u => u.Id == id)
                    .ExecuteUpdateAsync(
                        s => s.SetProperty(u => u.DisplayName, name)
                            .SetProperty(u => u.AvatarUrl, avatar)
                            .SetProperty(u => u.LastSeenAt, now),
                        cancellationToken);
                return id;
            }

            var user = new User
            {
                Id = Guid.CreateVersion7(),
                GoogleSubject = googleSubject,
                DisplayName = name,
                AvatarUrl = avatar,
                CreatedAt = now,
                LastSeenAt = now,
            };
            db.Users.Add(user);
            try
            {
                await db.SaveChangesAsync(cancellationToken);
                return user.Id;
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresUniqueViolation })
            {
                db.Entry(user).State = EntityState.Detached;
            }
        }

        throw new InvalidOperationException("Could not create the user.");
    }

    /// <summary>True when a user already exists for this Google subject (the sign-in will not create an account).</summary>
    public Task<bool> ExistsAsync(string googleSubject, CancellationToken cancellationToken = default) =>
        db.Users.AsNoTracking().AnyAsync(u => u.GoogleSubject == googleSubject, cancellationToken);

    /// <summary>Only an https URL on a Google user-content host is kept: the UI never loads an arbitrary image.</summary>
    public static string? SanitizeAvatarUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)
            || value.Length > User.MaxAvatarUrlLength
            || !Uri.TryCreate(value, UriKind.Absolute, out Uri? uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !uri.Host.EndsWith(".googleusercontent.com", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return uri.AbsoluteUri;
    }

    // No control or bidi-format characters (U+202E and friends) in a name shown to other people.
    private static string CleanName(string? value)
    {
        string cleaned = string.Concat((value ?? string.Empty).Where(static c =>
            !char.IsControl(c) && System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.Format)).Trim();
        return cleaned.Length == 0 ? "User" : cleaned;
    }

    private static string Truncate(string value, int max)
    {
        if (value.Length <= max)
        {
            return value;
        }

        // Never cut a surrogate pair in half: PostgreSQL would reject the invalid UTF-16.
        int length = char.IsHighSurrogate(value[max - 1]) ? max - 1 : max;
        return value[..length];
    }
}
