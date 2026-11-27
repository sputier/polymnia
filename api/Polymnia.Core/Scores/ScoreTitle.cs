using System.Globalization;
using System.Text;

namespace Polymnia.Core.Scores;

/// <summary>Title rules: trimmed, at most <see cref="ScoreLimits.MaxTitleLength"/> code points, no control characters.</summary>
public static class ScoreTitle
{
    /// <summary>Returns the trimmed title, or <c>null</c> when it is not acceptable.</summary>
    public static string? TrySanitize(string? title)
    {
        if (title is null)
        {
            return null;
        }

        string trimmed = title.Trim();
        int codePoints = 0;
        foreach (Rune rune in trimmed.EnumerateRunes())
        {
            if (++codePoints > ScoreLimits.MaxTitleLength || IsForbidden(rune))
            {
                return null;
            }
        }

        return trimmed;
    }

    /// <summary>Title of a copy: "title (copy)", cut so that the result stays valid.</summary>
    public static string ForCopy(string title)
    {
        ArgumentNullException.ThrowIfNull(title);
        const string suffix = " (copy)";
        StringBuilder builder = new();
        int count = 0;
        foreach (Rune rune in title.EnumerateRunes())
        {
            if (count + suffix.Length >= ScoreLimits.MaxTitleLength)
            {
                break;
            }

            builder.Append(rune.ToString());
            count++;
        }

        return builder.Append(suffix).ToString();
    }

    private static bool IsForbidden(Rune rune) =>
        Rune.IsControl(rune)
        // U+FFFD is what a lone surrogate decodes to.
        || rune.Value == 0xFFFD
        // Bidirectional overrides and isolates can make a title look different from what it is.
        || rune.Value is >= 0x202A and <= 0x202E
        || rune.Value is >= 0x2066 and <= 0x2069
        || Rune.GetUnicodeCategory(rune) == UnicodeCategory.OtherNotAssigned;
}
