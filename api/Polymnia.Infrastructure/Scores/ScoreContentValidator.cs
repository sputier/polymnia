using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Polymnia.Core.Scores;

namespace Polymnia.Infrastructure.Scores;

/// <summary>
/// Validates a score body against the embedded <c>schema/score.v1.schema.json</c> (JSON Schema draft 2020-12,
/// evaluated by <see cref="CompiledSchema"/>).
/// The schema covers structure and size limits; the semantic rules (voices filling measures, ties, slurs...) are
/// enforced by the client model and are not security relevant (a score is only ever read back by its owner).
/// </summary>
public sealed class ScoreContentValidator : IScoreContentValidator
{
    private const string SchemaResource = "score.v1.schema.json";
    private const int SupportedSchemaVersion = 1;
    private const int MaxErrorLength = 200;

    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);
    private static readonly JsonDocumentOptions ParseOptions = new() { MaxDepth = ScoreLimits.MaxJsonDepth };

    // Built once: a validator is immutable and thread-safe, and reusing it is what makes validation fast.
    private readonly CompiledSchema _v1 = CompiledSchema.Compile(LoadSchema());

    public ScoreValidationResult Validate(ReadOnlyMemory<byte> utf8Json)
    {
        string json;
        JsonDocument document;
        try
        {
            if (utf8Json.Span.StartsWith(new byte[] { 0xEF, 0xBB, 0xBF }))
            {
                return Fail("The body must not start with a byte order mark.");
            }

            json = StrictUtf8.GetString(utf8Json.Span);
            document = JsonDocument.Parse(utf8Json, ParseOptions);
        }
        catch (Exception ex) when (ex is JsonException or DecoderFallbackException)
        {
            return Fail("The body is not valid JSON.");
        }

        using (document)
        {
            JsonElement root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return Fail("The score must be a JSON object.");
            }

            if (!root.TryGetProperty("schemaVersion", out JsonElement version)
                || version.ValueKind != JsonValueKind.Number
                || !version.TryGetInt32(out int schemaVersion))
            {
                return Fail("schemaVersion is missing or is not an integer.");
            }

            if (schemaVersion != SupportedSchemaVersion)
            {
                return Fail($"Unsupported schemaVersion {schemaVersion}. Supported: {SupportedSchemaVersion}.");
            }

            List<string> path = [];
            if (!_v1.IsValid(root, path))
            {
                path.Reverse();
                return Fail($"The score does not match the schema at '/{string.Join('/', path)}'.");
            }

            // The schema guarantees meta.title is a string of at most 200 code points.
            string raw = root.GetProperty("meta").GetProperty("title").GetString()!;
            string? title = ScoreTitle.TrySanitize(raw);
            if (string.IsNullOrEmpty(title))
            {
                return Fail("The title must be 1 to 200 characters, without control characters.");
            }

            if (title != raw)
            {
                // Store the same trimmed title in the column and in the document.
                JsonNode node = JsonNode.Parse(json)!;
                node["meta"]!["title"] = title;
                json = node.ToJsonString();
            }

            return new ScoreValidationResult(new ScoreDocument(json, title, schemaVersion), null);
        }
    }

    private static ScoreValidationResult Fail(string error) =>
        new(null, error.Length <= MaxErrorLength ? error : error[..MaxErrorLength]);

    internal static string LoadSchema()
    {
        using Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(SchemaResource)
            ?? throw new InvalidOperationException($"Embedded resource '{SchemaResource}' is missing.");
        using StreamReader reader = new(stream, Encoding.UTF8);
        return reader.ReadToEnd();
    }
}
