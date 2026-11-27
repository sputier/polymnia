namespace Polymnia.Core.Users;

/// <summary>
/// One account creation, kept for two days to enforce the daily registration cap. A timestamp only: no user id, no
/// address, nothing personal, and not removed when the account is deleted (so create-delete cycles cannot reset the cap).
/// </summary>
public sealed class RegistrationEvent
{
    public long Id { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
