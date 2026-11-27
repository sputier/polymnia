using System.Threading.RateLimiting;
using Microsoft.Extensions.Options;

namespace Polymnia.Api.Auth;

/// <summary>
/// The per-address budget of new accounts (see <see cref="RegistrationOptions"/>): a fixed 24-hour window in memory,
/// per instance. Only taken for a sign-in that would create a user. The instance-wide daily cap is not here: it is
/// enforced exactly, under a database lock, by <c>UserProvisioner</c> (counted in <c>registration_events</c>).
/// </summary>
internal sealed class RegistrationGate : IDisposable
{
    private readonly PartitionedRateLimiter<string> _perAddress;

    public RegistrationGate(IOptions<AuthOptions> options)
    {
        int perAddress = options.Value.Registration.MaxNewAccountsPerAddressPerDay;
        _perAddress = PartitionedRateLimiter.Create<string, string>(key => RateLimitPartition.GetFixedWindowLimiter(
            key,
            _ => new FixedWindowRateLimiterOptions { PermitLimit = perAddress, Window = TimeSpan.FromDays(1), QueueLimit = 0 }));
    }

    /// <summary>True when this address may still create an account today (one permit is spent).</summary>
    public bool TryTakeAddress(string addressKey)
    {
        using RateLimitLease lease = _perAddress.AttemptAcquire(addressKey);
        return lease.IsAcquired;
    }

    public void Dispose() => _perAddress.Dispose();
}
