using System.Security.Cryptography;
using System.Text;

namespace Polymnia.Core.Sharing;

/// <summary>
/// The secret in a share link. It is 32 random bytes (256 bits, from the operating system CSPRNG) written as
/// base64url (43 characters, no padding). Only its SHA-256 hash is ever stored: the raw token exists in memory while
/// the link is created and in the URL the owner copies.
/// </summary>
public static class ShareToken
{
    public const int ByteLength = 32;

    /// <summary>Length of the base64url text of a token (32 bytes, no padding).</summary>
    public const int TextLength = 43;

    // 43 characters carry 258 bits: the last character only has 4 meaningful bits (its low 2 bits are zero).
    private const string LastCharacters = "AEIMQUYcgkosw048";

    public static string Generate() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(ByteLength)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>SHA-256 of the token text (32 bytes): what the database stores and looks up.</summary>
    public static byte[] Hash(string token)
    {
        ArgumentNullException.ThrowIfNull(token);
        return SHA256.HashData(Encoding.ASCII.GetBytes(token));
    }

    /// <summary>
    /// True when the text has the exact shape of a token. A malformed value cannot match any link, so it is refused
    /// without touching the database. The shape is public (it is documented), so this reveals nothing.
    /// </summary>
    public static bool IsWellFormed([System.Diagnostics.CodeAnalysis.NotNullWhen(true)] string? token)
    {
        if (token is null || token.Length != TextLength)
        {
            return false;
        }

        foreach (char c in token)
        {
            if (!(c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '-' or '_'))
            {
                return false;
            }
        }

        return LastCharacters.Contains(token[^1], StringComparison.Ordinal);
    }
}
