using System.Security.Claims;
using Polymnia.Core.Scores;

namespace Polymnia.Api.Scores;

/// <summary>
/// The caller, read from the authenticated principal: the <see cref="ClaimTypes.NameIdentifier"/> claim holds the
/// user id (a GUID). Any other value means "not signed in" (a malformed id never reaches the database).
/// </summary>
internal sealed class HttpCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public Guid? UserId =>
        accessor.HttpContext?.User is { Identity.IsAuthenticated: true } principal
        && Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out Guid id)
        && id != Guid.Empty
            ? id
            : null;
}
