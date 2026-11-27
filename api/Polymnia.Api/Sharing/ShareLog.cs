namespace Polymnia.Api.Sharing;

/// <summary>Audit events of the share links: internal ids only, never a token or a hash.</summary>
internal static partial class ShareLog
{
    public const string Category = "Polymnia.Sharing";

    public const int CreatedEventId = 20;
    public const int RevokedEventId = 21;

    [LoggerMessage(EventId = CreatedEventId, EventName = "ShareLinkCreated", Level = LogLevel.Information, Message = "User {UserId} created a share link for score {ScoreId}.")]
    public static partial void Created(ILogger logger, Guid userId, Guid scoreId);

    [LoggerMessage(EventId = RevokedEventId, EventName = "ShareLinkRevoked", Level = LogLevel.Information, Message = "User {UserId} revoked the share link of score {ScoreId}.")]
    public static partial void Revoked(ILogger logger, Guid userId, Guid scoreId);
}
