using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LateApexEarlySpeed.Json.Schema;
using Polymnia.Infrastructure.Scores;

namespace Polymnia.Tests;

/// <summary>
/// The server evaluates the schema with its own fast evaluator (see <c>CompiledSchema</c>). This checks it agrees
/// with an independent, complete JSON Schema implementation on valid and invalid documents.
/// </summary>
public sealed class ScoreSchemaConformanceTests
{
    private static readonly string SchemaText = File.ReadAllText(
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "schema", "score.v1.schema.json")));

    private static readonly JsonValidator Oracle = new(SchemaText);
    private static readonly ScoreContentValidator Subject = new();
    private static readonly string Small = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "score-small.json"));

    // (JSON pointer, replacement as JSON text, null = remove the property or element)
    public static TheoryData<string, string?> Edits => new()
    {
        { "/meta/title", "\"\\ud83c\\udfb5\"" },
        { "/meta/title", "123" },
        { "/meta/composer", null },
        { "/meta/tempoBpm", "19" },
        { "/meta/tempoBpm", "400" },
        { "/meta/tempoBpm", "401" },
        { "/meta/tempoBpm", "120.5" },
        { "/meta/tempoBpm", "120.0" },
        { "/meta/tempoBpm", "\"120\"" },
        { "/meta/extra", "1" },
        { "/extra", "true" },
        { "/id", "\"abc-1\"" },
        { "/id", "\"\"" },
        { "/id", "\"has space\"" },
        { "/id", "\"é\"" },
        { "/measures", "[]" },
        { "/measures/0/id", null },
        { "/measures/0/keyFifths", "7" },
        { "/measures/0/keyFifths", "8" },
        { "/measures/0/keyFifths", "-8" },
        { "/measures/0/time/beats", "0" },
        { "/measures/0/time/beats", "33" },
        { "/measures/1/length", "240" },
        { "/measures/1/length", "250" },
        { "/measures/1/length", "119" },
        { "/measures/1/length", "122880" },
        { "/measures/1/length", "122881" },
        { "/parts", "[]" },
        { "/parts/0/name", "\"x\"" },
        { "/parts/0/instrument", "\"\"" },
        { "/parts/0/transposition", "-37" },
        { "/parts/0/transposition", "36" },
        { "/parts/0/capo", "25" },
        { "/parts/0/capo", "24" },
        { "/parts/0/tuning", "[]" },
        { "/parts/0/staves", "[]" },
        { "/parts/0/staves/0/clef", "\"soprano\"" },
        { "/parts/0/staves/0/clef", "\"percussion\"" },
        { "/parts/0/staves/0/type", "\"tab\"" },
        { "/parts/0/staves/0/type", "\"other\"" },
        { "/parts/0/staves/0/measures/0/clef", "\"bass\"" },
        { "/parts/0/staves/0/measures/0/voices", "[]" },
        { "/parts/0/staves/0/measures/0/voices/0/id", "\"v 1\"" },
        { "/parts/0/staves/0/measures/0/voices/0/tuplets", null },
        { "/parts/0/staves/0/measures/0/voices/0/events", "[]" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/kind", "\"rest\"" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/kind", "\"chord\"" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/kind", null },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/pitches", "[]" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/pitches/0/step", "\"H\"" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/pitches/0/alter", "2" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/pitches/0/alter", "3" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/pitches/0/octave", "9" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/pitches/0/octave", "10" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/pitches/0/octave", "-2" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/pitches/0/tieToNext", "true" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/pitches/0/tieToNext", "1" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/pitches/0/fretting", "{\"string\":1,\"fret\":0}" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/pitches/0/fretting", "{\"string\":13,\"fret\":0}" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/pitches/0/fretting", "{\"string\":1,\"fret\":37}" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/duration/base", "\"64th\"" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/duration/dots", "2" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/duration/dots", "3" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/duration/dots", "true" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0/extra", "1" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0", "{\"kind\":\"rest\",\"id\":\"r1\",\"duration\":{\"base\":\"half\",\"dots\":0}}" },
        { "/parts/0/staves/0/measures/0/voices/0/events/0", "{\"kind\":\"rest\",\"id\":\"r1\",\"duration\":{\"base\":\"half\",\"dots\":0},\"pitches\":[]}" },
        { "/parts/0/staves/0/measures/0/voices/0/tuplets", "[{\"id\":\"t1\",\"actual\":3,\"normal\":2,\"eventIds\":[\"e1\",\"e2\",\"e3\"]}]" },
        { "/parts/0/staves/0/measures/0/voices/0/tuplets", "[{\"id\":\"t1\",\"actual\":3,\"normal\":2,\"eventIds\":[\"e1\"]}]" },
        { "/parts/0/staves/0/measures/0/voices/0/tuplets", "[{\"id\":\"t1\",\"actual\":10,\"normal\":2,\"eventIds\":[\"e1\",\"e2\"]}]" },
        { "/slurs", "[{\"id\":\"s1\",\"startEventId\":\"e1\",\"endEventId\":\"e2\"}]" },
        { "/slurs", "[{\"id\":\"s1\",\"startEventId\":\"e1\"}]" },
        { "/slurs", null },
    };

    [Fact]
    public void Both_fixtures_are_valid_for_both_implementations()
    {
        foreach (string name in new[] { "score-small.json", "score-500-measures.json" })
        {
            string text = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
            Assert.True(Oracle.Validate(text).IsValid, name);
            Assert.True(Subject.Validate(Encoding.UTF8.GetBytes(text)).IsValid, name);
        }
    }

    [Theory]
    [MemberData(nameof(Edits))]
    public void The_fast_evaluator_agrees_with_the_reference_implementation(string location, string? replacement)
    {
        JsonNode root = JsonNode.Parse(Small)!;
        Apply(root, location, replacement);
        string text = root.ToJsonString();

        bool expected = Oracle.Validate(text).IsValid;
        bool actual = Subject.Validate(Encoding.UTF8.GetBytes(text)).IsValid;

        Assert.True(expected == actual, $"{location} <- {replacement ?? "(removed)"}: reference says {expected}, server says {actual}");
    }

    [Fact]
    public void Limits_at_and_over_the_boundary_agree()
    {
        // Long titles counted in code points: 200 astral characters is valid, 201 is not.
        foreach (int count in new[] { 199, 200, 201 })
        {
            JsonNode root = JsonNode.Parse(Small)!;
            root["meta"]!["title"] = string.Concat(Enumerable.Repeat("\U0001F3B5", count));
            string text = root.ToJsonString();
            Assert.Equal(Oracle.Validate(text).IsValid, Subject.Validate(Encoding.UTF8.GetBytes(text)).IsValid);
        }

        // Too many parts / measures (array size limits).
        foreach (int count in new[] { 32, 33 })
        {
            JsonNode root = JsonNode.Parse(Small)!;
            JsonArray parts = root["parts"]!.AsArray();
            JsonNode first = parts[0]!;
            while (parts.Count < count)
            {
                parts.Add(first.DeepClone());
            }

            string text = root.ToJsonString();
            Assert.Equal(Oracle.Validate(text).IsValid, Subject.Validate(Encoding.UTF8.GetBytes(text)).IsValid);
        }
    }

    [Theory]
    [InlineData("m1\\n")]
    [InlineData("m1\\u2028")]
    [InlineData("m1\\u0000")]
    public void An_id_with_a_trailing_line_break_is_refused(string escapedId)
    {
        // The reference implementation lets "id\n" through (.NET '$' matches before a final newline).
        // The server must not: ids end up in selectors and file names on the client.
        string text = Small.Replace("\"id\":\"m1\"", $"\"id\":\"{escapedId}\"", StringComparison.Ordinal);
        Assert.False(Subject.Validate(Encoding.UTF8.GetBytes(text)).IsValid);
    }

    [Fact]
    public void An_unsupported_keyword_makes_loading_fail_instead_of_being_ignored()
    {
        Type type = typeof(ScoreContentValidator).Assembly.GetType("Polymnia.Infrastructure.Scores.CompiledSchema")!;
        var compile = type.GetMethod("Compile")!;
        var ex = Assert.Throws<System.Reflection.TargetInvocationException>(
            () => compile.Invoke(null, ["{\"type\":\"object\",\"uniqueItems\":true}"]));
        Assert.IsType<NotSupportedException>(ex.InnerException);
    }

    private static void Apply(JsonNode root, string location, string? replacement)
    {
        string[] parts = location.Split('/', StringSplitOptions.RemoveEmptyEntries);
        JsonNode node = root;
        foreach (string part in parts[..^1])
        {
            node = node is JsonArray array ? array[int.Parse(part, System.Globalization.CultureInfo.InvariantCulture)]! : node[part]!;
        }

        string last = parts[^1];
        JsonNode? value = replacement is null ? null : JsonNode.Parse(replacement);
        if (node is JsonArray target)
        {
            int index = int.Parse(last, System.Globalization.CultureInfo.InvariantCulture);
            if (value is null)
            {
                target.RemoveAt(index);
            }
            else
            {
                target[index] = value;
            }
        }
        else if (value is null)
        {
            node.AsObject().Remove(last);
        }
        else
        {
            node.AsObject()[last] = value;
        }
    }
}
