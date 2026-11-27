using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Polymnia.Infrastructure;
using Polymnia.Infrastructure.Users;

namespace Polymnia.Api.Auth;

/// <summary>Event handlers shared by the real Google scheme and the fake one used in tests.</summary>
internal static class SessionEvents
{
    private static readonly TimeSpan LastSeenGranularity = TimeSpan.FromHours(1);

    /// <summary>
    /// Google signed the user in. Creates or updates the user, then replaces the Google principal with a minimal one
    /// (internal user id and display name): nothing else from Google reaches the session.
    /// </summary>
    public static async Task OnTicketReceived(TicketReceivedContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        ClaimsPrincipal google = context.Principal ?? throw new InvalidOperationException("No principal.");
        string? subject = google.FindFirstValue("sub");
        if (string.IsNullOrWhiteSpace(subject))
        {
            context.Fail("Missing subject.");
            return;
        }

        UserProvisioner provisioner = context.HttpContext.RequestServices.GetRequiredService<UserProvisioner>();
        Guid userId = await provisioner.SignInAsync(
            subject,
            google.FindFirstValue("name"),
            google.FindFirstValue("picture"),
            context.HttpContext.RequestAborted);

        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, userId.ToString("D", CultureInfo.InvariantCulture))],
            AuthDefaults.CookieScheme);

        TimeSpan idle = context.HttpContext.RequestServices.GetRequiredService<IOptions<AuthOptions>>().Value.IdleTimeout;
        TimeProvider time = context.HttpContext.RequestServices.GetRequiredService<TimeProvider>();

        context.Principal = new ClaimsPrincipal(identity);

        // Fresh properties: the OIDC state (correlation, nonce, ...) must not be copied into the session.
        context.Properties = new AuthenticationProperties { IsPersistent = true, ExpiresUtc = time.GetUtcNow() + idle };

        // The return URL was validated at login and travels in protected state; validate again anyway.
        context.ReturnUri = ReturnUrl.Sanitize(context.ReturnUri);
    }

    /// <summary>Runs on every request that carries a session: the user must still exist.</summary>
    public static async Task OnValidatePrincipal(CookieValidatePrincipalContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        string? idClaim = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(idClaim, CultureInfo.InvariantCulture, out Guid userId))
        {
            await Reject(context);
            return;
        }

        PolymniaDbContext db = context.HttpContext.RequestServices.GetRequiredService<PolymniaDbContext>();
        TimeProvider time = context.HttpContext.RequestServices.GetRequiredService<TimeProvider>();
        CancellationToken ct = context.HttpContext.RequestAborted;

        DateTimeOffset? lastSeen = await db.Users
            .AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => (DateTimeOffset?)u.LastSeenAt)
            .FirstOrDefaultAsync(ct);

        if (lastSeen is null)
        {
            await Reject(context);
            return;
        }

        DateTimeOffset now = time.GetUtcNow();
        if (now - lastSeen.Value > LastSeenGranularity)
        {
            await db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(s => s.SetProperty(u => u.LastSeenAt, now), ct);
        }
    }

    public static Task OnRedirectToLogin(RedirectContext<CookieAuthenticationOptions> context)
    {
        ArgumentNullException.ThrowIfNull(context);
        // An API never redirects to Google: the front end decides when to start the sign-in.
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Task.CompletedTask;
    }

    public static Task OnRedirectToAccessDenied(RedirectContext<CookieAuthenticationOptions> context)
    {
        ArgumentNullException.ThrowIfNull(context);
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    }

    /// <summary>The user cancelled at Google or the callback was invalid: go back to the app, never show the error.</summary>
    public static Task OnRemoteFailure(RemoteFailureContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        ILogger logger = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Polymnia.Auth");
        AuthLog.SignInFailed(logger, context.Failure?.GetType().Name ?? "unknown");

        context.Response.Redirect("/?signin=failed");
        context.HandleResponse();
        return Task.CompletedTask;
    }

    private static async Task Reject(CookieValidatePrincipalContext context)
    {
        context.RejectPrincipal();
        await context.HttpContext.SignOutAsync(AuthDefaults.CookieScheme);
    }
}
