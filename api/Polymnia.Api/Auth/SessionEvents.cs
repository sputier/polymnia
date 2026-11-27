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

        // Re-authentication must be by the same Google account as the session that asked for it.
        if (context.Properties?.Items.TryGetValue(AuthDefaults.ReauthProperty, out string? expected) == true)
        {
            PolymniaDbContext db = context.HttpContext.RequestServices.GetRequiredService<PolymniaDbContext>();
            string? knownSubject = Guid.TryParse(expected, CultureInfo.InvariantCulture, out Guid expectedId)
                ? await db.Users.Where(u => u.Id == expectedId).Select(u => u.GoogleSubject).FirstOrDefaultAsync(context.HttpContext.RequestAborted)
                : null;
            if (knownSubject is null || knownSubject != subject)
            {
                context.Fail("Re-authentication with a different account.");
                return;
            }
        }

        UserProvisioner provisioner =context.HttpContext.RequestServices.GetRequiredService<UserProvisioner>();
        Guid userId = await provisioner.SignInAsync(
            subject,
            google.FindFirstValue("name"),
            google.FindFirstValue("picture"),
            context.HttpContext.RequestAborted);

        TimeSpan idle = context.HttpContext.RequestServices.GetRequiredService<IOptions<AuthOptions>>().Value.IdleTimeout;
        TimeProvider time = context.HttpContext.RequestServices.GetRequiredService<TimeProvider>();

        // auth_time: when Google signed this person in. Sliding renewal never changes it, so "signed in recently"
        // (account deletion) cannot be obtained by keeping a stolen session alive.
        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, userId.ToString("D", CultureInfo.InvariantCulture)),
                new Claim(AuthDefaults.AuthTimeClaim, time.GetUtcNow().ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture), ClaimValueTypes.Integer64),
            ],
            AuthDefaults.CookieScheme);

        context.Principal = new ClaimsPrincipal(identity);

        // Fresh properties: the OIDC state (correlation, nonce, ...) must not be copied into the session.
        context.Properties = new AuthenticationProperties { IsPersistent = true, ExpiresUtc = time.GetUtcNow() + idle };

        // The return URL was validated at login and travels in protected state; validate again anyway.
        context.ReturnUri = ReturnUrl.Sanitize(context.ReturnUri);
    }

    /// <summary>Audit: the session now exists (the cookie is issued and the ticket stored). User id only.</summary>
    public static Task OnSignedIn(CookieSignedInContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        if (Guid.TryParse(context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier), CultureInfo.InvariantCulture, out Guid userId))
        {
            ILogger audit = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(AuthLog.Category);
            AuthLog.SignedIn(audit, userId);
        }

        return Task.CompletedTask;
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

        // The ticket store loaded the session and its user in one query and left the last-seen time here.
        // Without it the ticket did not come from the store in this request: reject.
        if (!context.HttpContext.Items.TryGetValue(DbTicketStore.LastSeenItemKey, out object? item) || item is not DateTimeOffset lastSeen)
        {
            await Reject(context);
            return;
        }

        TimeProvider time = context.HttpContext.RequestServices.GetRequiredService<TimeProvider>();
        DateTimeOffset now = time.GetUtcNow();
        if (now - lastSeen > LastSeenGranularity)
        {
            PolymniaDbContext db = context.HttpContext.RequestServices.GetRequiredService<PolymniaDbContext>();
            await db.Users
                .Where(u => u.Id == userId)
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.LastSeenAt, now), context.HttpContext.RequestAborted);
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

        ILogger logger = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(AuthLog.Category);
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
