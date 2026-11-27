using Polymnia.Core.Contact;

namespace Polymnia.Api.Contact;

/// <summary>
/// A plain e-mail address: <c>local@domain</c> in ASCII, nothing else. No display name, no quotes, no comments, no
/// comma or semicolon (so never two addresses), no angle brackets, no space, no control character. The strictness is the
/// defence against header injection: such a value can only ever be one mailbox.
/// </summary>
internal static class ContactAddress
{
    public static bool IsValid(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > ContactLimits.MaxReplyToLength)
        {
            return false;
        }

        int at = value.IndexOf('@', StringComparison.Ordinal);
        if (at < 1 || at != value.LastIndexOf('@'))
        {
            return false;
        }

        return IsLocalPart(value.AsSpan(0, at)) && IsDomain(value.AsSpan(at + 1));
    }

    private static bool IsLocalPart(ReadOnlySpan<char> local)
    {
        if (local.Length is 0 or > 64 || local[0] == '.' || local[^1] == '.')
        {
            return false;
        }

        char previous = '\0';
        foreach (char c in local)
        {
            if (!(char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '+' or '-') || (c == '.' && previous == '.'))
            {
                return false;
            }

            previous = c;
        }

        return true;
    }

    private static bool IsDomain(ReadOnlySpan<char> domain)
    {
        if (domain.Length is 0 or > 253)
        {
            return false;
        }

        int labels = 0;
        bool lastNumeric = false;
        foreach (Range range in domain.Split('.'))
        {
            ReadOnlySpan<char> label = domain[range];
            if (label.Length is 0 or > 63 || label[0] == '-' || label[^1] == '-')
            {
                return false;
            }

            lastNumeric = true;
            foreach (char c in label)
            {
                if (!(char.IsAsciiLetterOrDigit(c) || c == '-'))
                {
                    return false;
                }

                lastNumeric &= char.IsAsciiDigit(c);
            }

            labels++;
        }

        // At least "name.tld", and a TLD that is not all digits (that would be an IPv4 literal).
        return labels >= 2 && !lastNumeric;
    }
}

/// <summary>Validation of the free text of the form.</summary>
internal static class ContactText
{
    /// <summary>
    /// Normalizes line breaks to <c>\n</c> and trims. Returns <c>null</c> when the text holds a character that has no
    /// business in a message: a control character other than newline and tab, an unpaired surrogate, a non-character,
    /// a line or paragraph separator, or a bidirectional override (it could make the operator read something else).
    /// </summary>
    public static string? Clean(string value)
    {
        ArgumentNullException.ThrowIfNull(value);

        string text = value.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n').Trim();
        for (int i = 0; i < text.Length; i++)
        {
            char c = text[i];
            if (char.IsHighSurrogate(c))
            {
                if (i + 1 >= text.Length || !char.IsLowSurrogate(text[i + 1]))
                {
                    return null;
                }

                i++;
                continue;
            }

            if (char.IsLowSurrogate(c) || (char.IsControl(c) && c is not ('\n' or '\t')) || IsForbiddenFormat(c))
            {
                return null;
            }
        }

        return text;
    }

    /// <summary>U+FFFE and U+FFFF, the line and paragraph separators (U+2028, U+2029) and the bidirectional embeddings, overrides and isolates (U+202A to U+202E, U+2066 to U+2069).</summary>
    private static bool IsForbiddenFormat(char c) =>
        (int)c is 0xFFFE or 0xFFFF or 0x2028 or 0x2029 || (int)c is >= 0x202A and <= 0x202E || (int)c is >= 0x2066 and <= 0x2069;
}
