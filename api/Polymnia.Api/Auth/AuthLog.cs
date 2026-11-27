namespace Polymnia.Api.Auth;

internal static partial class AuthLog
{
    [LoggerMessage(EventId = 1, Level = LogLevel.Warning, Message = "A stored session could not be decrypted.")]
    public static partial void SessionUndecryptable(ILogger logger, Exception exception);

    [LoggerMessage(EventId = 2, Level = LogLevel.Debug, Message = "Removed {Count} expired sessions.")]
    public static partial void SessionsRemoved(ILogger logger, int count);

    [LoggerMessage(EventId = 3, Level = LogLevel.Warning, Message = "Session cleanup failed.")]
    public static partial void CleanupFailed(ILogger logger, Exception exception);

    [LoggerMessage(EventId = 4, Level = LogLevel.Warning, Message = "Google sign-in failed: {FailureType}.")]
    public static partial void SignInFailed(ILogger logger, string failureType);
}
