using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Polymnia.Infrastructure;
using Polymnia.Infrastructure.Sessions;

namespace Polymnia.Api.Auth;

/// <summary>
/// Keeps the authentication ticket in PostgreSQL. The cookie only carries an unguessable key, so a session can
/// be ended on the server (logout, user deleted, absolute lifetime) and a copied cookie stops working then.
/// Loading a session also proves the user still exists (one joined query per request).
/// </summary>
internal sealed class DbTicketStore(
    IServiceScopeFactory scopes,
    IDataProtectionProvider dataProtection,
    IOptions<AuthOptions> options,
    TimeProvider time,
    ILogger<DbTicketStore> logger) : ITicketStore
{
    /// <summary>
    /// <see cref="HttpContext.Items"/> key under which <see cref="RetrieveAsync(string, HttpContext, CancellationToken)"/>
    /// leaves the user's last-seen time. Its presence means "the session and the user were found in this request".
    /// </summary>
    internal const string LastSeenItemKey = "Polymnia.Auth.LastSeenAt";

    private const int KeyBytes = 32;

    private readonly IDataProtector _protector = dataProtection.CreateProtector("Polymnia.Auth.Session.v1");

    public Task<string> StoreAsync(AuthenticationTicket ticket) => StoreCoreAsync(ticket, CancellationToken.None);

    public Task<string> StoreAsync(AuthenticationTicket ticket, CancellationToken cancellationToken) =>
        StoreCoreAsync(ticket, cancellationToken);

    public Task<string> StoreAsync(AuthenticationTicket ticket, HttpContext httpContext, CancellationToken cancellationToken) =>
        StoreCoreAsync(ticket, cancellationToken);

    public Task RenewAsync(string key, AuthenticationTicket ticket) => RenewCoreAsync(key, ticket, CancellationToken.None);

    public Task RenewAsync(string key, AuthenticationTicket ticket, CancellationToken cancellationToken) =>
        RenewCoreAsync(key, ticket, cancellationToken);

    public Task RenewAsync(string key, AuthenticationTicket ticket, HttpContext httpContext, CancellationToken cancellationToken) =>
        RenewCoreAsync(key, ticket, cancellationToken);

    public Task<AuthenticationTicket?> RetrieveAsync(string key) => RetrieveCoreAsync(key, null, CancellationToken.None);

    public Task<AuthenticationTicket?> RetrieveAsync(string key, CancellationToken cancellationToken) =>
        RetrieveCoreAsync(key, null, cancellationToken);

    public Task<AuthenticationTicket?> RetrieveAsync(string key, HttpContext httpContext, CancellationToken cancellationToken) =>
        RetrieveCoreAsync(key, httpContext, cancellationToken);

    public Task RemoveAsync(string key) => RemoveCoreAsync(key, CancellationToken.None);

    public Task RemoveAsync(string key, CancellationToken cancellationToken) => RemoveCoreAsync(key, cancellationToken);

    public Task RemoveAsync(string key, HttpContext httpContext, CancellationToken cancellationToken) =>
        RemoveCoreAsync(key, cancellationToken);

    private async Task<string> StoreCoreAsync(AuthenticationTicket ticket, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(ticket);

        string idClaim = ticket.Principal.FindFirstValue(ClaimTypes.NameIdentifier) ?? string.Empty;
        if (!Guid.TryParse(idClaim, CultureInfo.InvariantCulture, out Guid userId))
        {
            throw new InvalidOperationException("The ticket has no user id.");
        }

        string key = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(KeyBytes));
        DateTimeOffset now = time.GetUtcNow();

        await using AsyncServiceScope scope = scopes.CreateAsyncScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        db.Sessions.Add(new UserSession
        {
            KeyHash = Hash(key),
            UserId = userId,
            Ticket = Protect(ticket),
            CreatedAt = now,
            ExpiresAt = Min(ticket.Properties.ExpiresUtc ?? now + options.Value.IdleTimeout, now + options.Value.AbsoluteTimeout),
            AbsoluteExpiresAt = now + options.Value.AbsoluteTimeout,
        });
        await db.SaveChangesAsync(cancellationToken);
        return key;
    }

    private async Task RenewCoreAsync(string key, AuthenticationTicket ticket, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(ticket);

        string hash = Hash(key);
        DateTimeOffset now = time.GetUtcNow();
        DateTimeOffset expires = ticket.Properties.ExpiresUtc ?? now + options.Value.IdleTimeout;
        byte[] protectedTicket = Protect(ticket);

        await using AsyncServiceScope scope = scopes.CreateAsyncScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();

        // Only a live session is renewed, and the sliding expiry is capped by the absolute one.
        await db.Sessions
            .Where(s => s.KeyHash == hash && s.ExpiresAt > now && s.AbsoluteExpiresAt > now)
            .ExecuteUpdateAsync(
                s => s
                    .SetProperty(x => x.Ticket, protectedTicket)
                    .SetProperty(x => x.ExpiresAt, x => expires < x.AbsoluteExpiresAt ? expires : x.AbsoluteExpiresAt),
                cancellationToken);
    }

    private async Task<AuthenticationTicket?> RetrieveCoreAsync(string key, HttpContext? httpContext, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(key) || key.Length > 128)
        {
            return null;
        }

        string hash = Hash(key);
        DateTimeOffset now = time.GetUtcNow();

        await using AsyncServiceScope scope = scopes.CreateAsyncScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();

        // One query: the live session and its user. A session whose user is gone is not found.
        var found = await db.Sessions
            .AsNoTracking()
            .Where(s => s.KeyHash == hash && s.ExpiresAt > now && s.AbsoluteExpiresAt > now)
            .Join(db.Users, s => s.UserId, u => u.Id, (s, u) => new { s.Ticket, s.UserId, u.LastSeenAt })
            .FirstOrDefaultAsync(cancellationToken);

        if (found is null)
        {
            return null;
        }

        AuthenticationTicket? ticket;
        try
        {
            ticket = TicketSerializer.Default.Deserialize(_protector.Unprotect(found.Ticket));
        }
        catch (Exception ex) when (ex is CryptographicException or IOException or FormatException or InvalidOperationException)
        {
            // Keys lost or rotated away, or a damaged row: unusable. Drop it so it is not retried on every request.
            AuthLog.SessionUndecryptable(logger, ex);
            await TryDeleteAsync(db, hash);
            return null;
        }

        // Defence in depth: the user in the ticket is the user the session row belongs to.
        if (!Guid.TryParse(ticket?.Principal.FindFirstValue(ClaimTypes.NameIdentifier), CultureInfo.InvariantCulture, out Guid ticketUser)
            || ticketUser != found.UserId)
        {
            await TryDeleteAsync(db, hash);
            return null;
        }

        if (httpContext is not null)
        {
            httpContext.Items[LastSeenItemKey] = found.LastSeenAt;
        }

        return ticket;
    }

    private async Task RemoveCoreAsync(string key, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(key))
        {
            return;
        }

        string hash = Hash(key);
        await using AsyncServiceScope scope = scopes.CreateAsyncScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        await db.Sessions.Where(s => s.KeyHash == hash).ExecuteDeleteAsync(cancellationToken);
    }

    /// <summary>Best effort: a failure here must not turn "no session" into a server error.</summary>
    private static async Task TryDeleteAsync(PolymniaDbContext db, string hash)
    {
        try
        {
            await db.Sessions.Where(s => s.KeyHash == hash).ExecuteDeleteAsync(CancellationToken.None);
        }
#pragma warning disable CA1031 // The row is also removed by the hourly cleanup.
        catch (Exception)
#pragma warning restore CA1031
        {
        }
    }

    private static DateTimeOffset Min(DateTimeOffset a, DateTimeOffset b) => a < b ? a : b;

    private byte[] Protect(AuthenticationTicket ticket) => _protector.Protect(TicketSerializer.Default.Serialize(ticket));

    private static string Hash(string key) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(key)));
}

/// <summary>Deletes expired sessions once an hour. They are already unusable; this only keeps the table small.</summary>
internal sealed class SessionCleanupService(
    IServiceScopeFactory scopes,
    TimeProvider time,
    ILogger<SessionCleanupService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval, time);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using AsyncServiceScope scope = scopes.CreateAsyncScope();
                PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
                DateTimeOffset now = time.GetUtcNow();
                int removed = await db.Sessions
                    .Where(s => s.ExpiresAt <= now)
                    .ExecuteDeleteAsync(stoppingToken);
                AuthLog.SessionsRemoved(logger, removed);
            }
#pragma warning disable CA1031 // A failed cleanup must never stop the host; it is retried at the next tick.
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
#pragma warning restore CA1031
            {
                AuthLog.CleanupFailed(logger, ex);
            }
        }
    }
}
