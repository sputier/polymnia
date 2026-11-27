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
/// </summary>
internal sealed class DbTicketStore(
    IServiceScopeFactory scopes,
    IDataProtectionProvider dataProtection,
    IOptions<AuthOptions> options,
    TimeProvider time,
    ILogger<DbTicketStore> logger) : ITicketStore
{
    private const int KeyBytes = 32;

    private readonly IDataProtector _protector = dataProtection.CreateProtector("Polymnia.Auth.Session.v1");

    public async Task<string> StoreAsync(AuthenticationTicket ticket)
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
        await db.SaveChangesAsync();
        return key;
    }

    public async Task RenewAsync(string key, AuthenticationTicket ticket)
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
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.Ticket, protectedTicket)
                .SetProperty(x => x.ExpiresAt, x => expires < x.AbsoluteExpiresAt ? expires : x.AbsoluteExpiresAt));
    }

    public async Task<AuthenticationTicket?> RetrieveAsync(string key)
    {
        if (string.IsNullOrEmpty(key) || key.Length > 128)
        {
            return null;
        }

        string hash = Hash(key);
        DateTimeOffset now = time.GetUtcNow();

        await using AsyncServiceScope scope = scopes.CreateAsyncScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        byte[]? stored = await db.Sessions
            .AsNoTracking()
            .Where(s => s.KeyHash == hash && s.ExpiresAt > now && s.AbsoluteExpiresAt > now)
            .Select(s => s.Ticket)
            .FirstOrDefaultAsync();

        if (stored is null)
        {
            return null;
        }

        try
        {
            return TicketSerializer.Default.Deserialize(_protector.Unprotect(stored));
        }
        catch (Exception ex) when (ex is CryptographicException or IOException or FormatException or InvalidOperationException)
        {
            // Keys lost or rotated away: the session is unusable, the user signs in again.
            AuthLog.SessionUndecryptable(logger, ex);
            return null;
        }
    }

    public async Task RemoveAsync(string key)
    {
        if (string.IsNullOrEmpty(key))
        {
            return;
        }

        string hash = Hash(key);
        await using AsyncServiceScope scope = scopes.CreateAsyncScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        await db.Sessions.Where(s => s.KeyHash == hash).ExecuteDeleteAsync();
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
