using System.Globalization;
using System.Text;
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
    /// Normalizes line breaks to <c>\n</c>, drops every Unicode format character (category Cf) and trims. Returns
    /// <c>null</c> when the text holds a character that has no business in a message: a control character other than
    /// newline and tab (category Cc), an unpaired surrogate, a non-character, or a line or paragraph separator.
    /// </summary>
    public static string? Clean(string value)
    {
        ArgumentNullException.ThrowIfNull(value);

        string text = value.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');
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

            if (IsForbidden(c))
            {
                return null;
            }
        }

        // Every format character (Unicode category Cf: zero-width characters and joiners, bidirectional controls and
        // isolates, the soft hyphen, the byte order mark, the tag characters) is dropped: invisible in the text, they
        // could hide or reorder what the operator reads. Whole code points (the tag characters are surrogate pairs).
        StringBuilder clean = new(text.Length);
        foreach (Rune rune in text.EnumerateRunes())
        {
            if (Rune.GetUnicodeCategory(rune) != UnicodeCategory.Format && !IsInvisibleFiller(rune.Value))
            {
                clean.Append(rune.ToString());
            }
        }

        return clean.ToString().Trim();
    }

    /// <summary>Blank-looking characters outside category Cf: the Hangul fillers, the Braille blank and the combining grapheme joiner.</summary>
    private static bool IsInvisibleFiller(int codePoint) =>
        codePoint is 0x115F or 0x1160 or 0x3164 or 0xFFA0 or 0x2800 or 0x034F;

    private static bool IsForbidden(char c) =>
        char.IsLowSurrogate(c) || (char.IsControl(c) && c is not ('\n' or '\t')) || (int)c is 0xFFFE or 0xFFFF or 0x2028 or 0x2029;
}
