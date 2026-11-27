namespace Polymnia.Core.Users;

/// <summary>
/// A person who signed in with Google. Only the minimum is kept: the Google subject identifier (a stable,
/// opaque id), the display name and avatar URL shown in the UI, and the preferred language.
/// No e-mail address and no Google token is stored.
/// </summary>
public sealed class User
{
    public const int MaxSubjectLength = 255;
    public const int MaxDisplayNameLength = 200;
    public const int MaxAvatarUrlLength = 2048;
    public const int MaxLanguageLength = 8;

    public Guid Id { get; set; }

    /// <summary>Google <c>sub</c> claim. Unique.</summary>
    public required string GoogleSubject { get; set; }

    public required string DisplayName { get; set; }

    public string? AvatarUrl { get; set; }

    /// <summary>BCP 47 primary language ("en", "fr"), or <c>null</c> until the user chooses one.</summary>
    public string? PreferredLanguage { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset LastSeenAt { get; set; }
}
