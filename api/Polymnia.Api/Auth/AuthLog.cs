namespace Polymnia.Api.Auth;

internal static partial class AuthLog
{
    public const string Category = "Polymnia.Auth";

    [LoggerMessage(EventId = 1, Level = LogLevel.Warning, Message = "A stored session could not be decrypted.")]
    public static partial void SessionUndecryptable(ILogger logger, Exception exception);

    [LoggerMessage(EventId = 2, Level = LogLevel.Debug, Message = "Removed {Count} expired sessions.")]
    public static partial void SessionsRemoved(ILogger logger, int count);

    [LoggerMessage(EventId = 3, Level = LogLevel.Warning, Message = "Session cleanup failed.")]
    public static partial void CleanupFailed(ILogger logger, Exception exception);

    [LoggerMessage(EventId = 4, EventName = "AuthSignInFailed", Level = LogLevel.Warning, Message = "Google sign-in failed: {FailureType}.")]
    public static partial void SignInFailed(ILogger logger, string failureType);

    // Audit events: stable ids, the internal user id only (never a name, e-mail, subject or token).
    public const int SignedInEventId = 10;
    public const int SignedOutEventId = 11;

    [LoggerMessage(EventId = SignedInEventId, EventName = "AuthSignedIn", Level = LogLevel.Information, Message = "User {UserId} signed in.")]
    public static partial void SignedIn(ILogger logger, Guid userId);

    [LoggerMessage(EventId = SignedOutEventId, EventName = "AuthSignedOut", Level = LogLevel.Information, Message = "User {UserId} signed out.")]
    public static partial void SignedOut(ILogger logger, Guid userId);

    [LoggerMessage(EventId = 12, EventName = "AuthRateLimited", Level = LogLevel.Warning, Message = "Auth rate limit reached ({Count} rejected requests, logged at most every 10 seconds).")]
    public static partial void RateLimited(ILogger logger, int count);
}
