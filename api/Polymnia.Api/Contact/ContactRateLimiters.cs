using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.Extensions.Options;
using Polymnia.Api.Auth;

namespace Polymnia.Api.Contact;

/// <summary>A budget that is spent: its lease (for <c>Retry-After</c>) and which budget it was.</summary>
internal readonly record struct Refusal(RateLimitLease Lease, string Scope);

/// <summary>
/// Budgets of the contact form: messages per client address and in total per hour, and form tokens per address. In
/// memory, per instance: with several instances the budgets apply to each one (docs/contact.md).
/// </summary>
internal sealed class ContactRateLimiters : IDisposable
{
    private static readonly TimeSpan Window = TimeSpan.FromHours(1);

    private readonly PartitionedRateLimiter<string> _perAddress;
    private readonly PartitionedRateLimiter<string> _tokens;
    private readonly FixedWindowRateLimiter _global;

    public ContactRateLimiters(IOptions<ContactOptions> options)
    {
        ContactOptions o = options.Value;
        _perAddress = Fixed(o.AddressPerHour);
        _tokens = Fixed(o.TokensPerAddressPerHour);
        _global = new FixedWindowRateLimiter(new FixedWindowRateLimiterOptions
        {
            PermitLimit = o.GlobalPerHour,
            Window = Window,
            QueueLimit = 0,
        });
    }

    /// <summary>The partition of a client: the IPv4 address or the IPv6 /64, like the other public endpoints.</summary>
    public static string Key(HttpContext context) => AuthExtensions.ClientKey(context.Connection.RemoteIpAddress) ?? "unknown";

    /// <summary>Charges one message to the address then to the global budget. Returns the refusal, or <c>null</c>.</summary>
    public async ValueTask<Refusal?> TryAddressAsync(string key, CancellationToken ct)
    {
        RateLimitLease address = await _perAddress.AcquireAsync(key, 1, ct);
        return address.IsAcquired ? null : new Refusal(address, "address");
    }

    /// <summary>
    /// The shared budget, charged only for a submission that holds a valid token and is not a honeypot hit: junk
    /// requests (no token, robots) spend their own address's budget but cannot lock everyone else out.
    /// </summary>
    public async ValueTask<Refusal?> TryGlobalAsync(CancellationToken ct)
    {
        RateLimitLease global = await _global.AcquireAsync(1, ct);
        return global.IsAcquired ? null : new Refusal(global, "global");
    }

    public async ValueTask<Refusal?> TryIssueTokenAsync(string key, CancellationToken ct)
    {
        RateLimitLease lease = await _tokens.AcquireAsync(key, 1, ct);
        return lease.IsAcquired ? null : new Refusal(lease, "token");
    }

    /// <summary>The <c>Retry-After</c> value, in whole seconds, of a refusal.</summary>
    public static string RetryAfter(Refusal denied) =>
        (denied.Lease.TryGetMetadata(MetadataName.RetryAfter, out TimeSpan delay) ? Math.Max(1, (int)Math.Ceiling(delay.TotalSeconds)) : 60)
            .ToString(CultureInfo.InvariantCulture);

    public void Dispose()
    {
        _perAddress.Dispose();
        _tokens.Dispose();
        _global.Dispose();
    }

    private static PartitionedRateLimiter<string> Fixed(int permits) =>
        PartitionedRateLimiter.Create<string, string>(key => RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permits,
            Window = Window,
            QueueLimit = 0,
        }));
}
