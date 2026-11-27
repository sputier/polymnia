using System.Threading.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Polymnia.Infrastructure;

namespace Polymnia.Api.Auth;

/// <summary>
/// Decides whether a person who has no account yet may create one now (see <see cref="RegistrationOptions"/>).
/// The instance-wide count comes from the users table (rolling 24 hours); the per-address budget is a fixed 24-hour
/// window in memory. Only called for a sign-in that would create a user: existing accounts never pass through it.
/// </summary>
internal sealed class RegistrationGate : IDisposable
{
    private static readonly TimeSpan Window = TimeSpan.FromDays(1);

    private readonly IOptions<AuthOptions> _options;
    private readonly TimeProvider _time;
    private readonly PartitionedRateLimiter<string> _perAddress;

    public RegistrationGate(IOptions<AuthOptions> options, TimeProvider time)
    {
        _options = options;
        _time = time;
        int perAddress = options.Value.Registration.MaxNewAccountsPerAddressPerDay;
        _perAddress = PartitionedRateLimiter.Create<string, string>(key => RateLimitPartition.GetFixedWindowLimiter(
            key,
            _ => new FixedWindowRateLimiterOptions { PermitLimit = perAddress, Window = Window, QueueLimit = 0 }));
    }

    /// <summary>The refused scope (<c>"instance"</c> or <c>"address"</c>), or <c>null</c> when the account may be created.</summary>
    public async Task<string?> CheckAsync(PolymniaDbContext db, string addressKey, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);

        DateTimeOffset since = _time.GetUtcNow() - Window;
        int recent = await db.Users.AsNoTracking().CountAsync(u => u.CreatedAt > since, ct);
        if (recent >= _options.Value.Registration.MaxNewAccountsPerDay)
        {
            return "instance";
        }

        using RateLimitLease lease = _perAddress.AttemptAcquire(addressKey);
        return lease.IsAcquired ? null : "address";
    }

    public void Dispose() => _perAddress.Dispose();
}
