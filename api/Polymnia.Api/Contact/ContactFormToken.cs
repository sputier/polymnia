using System.Buffers.Binary;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;

namespace Polymnia.Api.Contact;

/// <summary>Why a form token was refused. Never told to the client in detail: one code for all of them.</summary>
internal enum FormTokenResult
{
    Valid,
    Malformed,
    TooEarly,
    Expired,
}

/// <summary>
/// The short-lived token that plays the role of the antiforgery cookie for a signed-out visitor: it is signed and
/// encrypted by Data Protection (keys in the database), so it cannot be forged or edited, and it carries the time it
/// was issued, so it expires and a bot cannot submit the instant it fetches it. A page of another site can neither
/// read it (same-origin policy, no CORS) nor send the JSON the endpoint requires without a preflight, so no cross-site
/// request is possible (the JSON content type is the guard). The token is not bound to a session or address: anyone can fetch one. It is not single use: the rate limits are what bounds replays.
/// </summary>
internal sealed class ContactFormTokens(IDataProtectionProvider provider, TimeProvider clock, IOptions<ContactOptions> options)
{
    private const string Purpose = "Polymnia.Contact.FormToken.v1";
    private const int NonceBytes = 16;
    private const int MaxTokenLength = 256;

    private readonly IDataProtector _protector = provider.CreateProtector(Purpose);

    public string Issue()
    {
        byte[] payload = new byte[8 + NonceBytes];
        BinaryPrimitives.WriteInt64BigEndian(payload, clock.GetUtcNow().ToUnixTimeSeconds());
        RandomNumberGenerator.Fill(payload.AsSpan(8));
        return WebEncoders.Base64UrlEncode(_protector.Protect(payload));
    }

    public FormTokenResult Validate(string? token)
    {
        if (string.IsNullOrEmpty(token) || token.Length > MaxTokenLength)
        {
            return FormTokenResult.Malformed;
        }

        byte[] payload;
        try
        {
            payload = _protector.Unprotect(WebEncoders.Base64UrlDecode(token));
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException)
        {
            return FormTokenResult.Malformed;
        }

        if (payload.Length != 8 + NonceBytes)
        {
            return FormTokenResult.Malformed;
        }

        long issued = BinaryPrimitives.ReadInt64BigEndian(payload);
        long age = clock.GetUtcNow().ToUnixTimeSeconds() - issued;
        ContactOptions o = options.Value;
        if (age < o.MinFillSeconds)
        {
            return FormTokenResult.TooEarly;
        }

        return age > o.TokenLifetimeMinutes * 60L ? FormTokenResult.Expired : FormTokenResult.Valid;
    }
}
