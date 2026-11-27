using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Unicode;
using Polymnia.Core.Scores;

namespace Polymnia.Infrastructure.Scores;

/// <summary>
/// Parses and validates the body of <c>PATCH /api/scores/{id}/content</c>:
/// <c>{ "ops": [ { "op": "...", ... } ] }</c>. Nothing is trusted: the JSON must be strict (no duplicate property, no
/// unknown property), and every fragment a patch carries (a measure, a part, the metadata, the slurs) is checked by the
/// same <see cref="CompiledSchema"/> that validates a full document. The rules that need the stored document (unknown
/// ids, counts that must stay consistent, the global array limits) are checked when the patch is applied
/// (<see cref="ScorePatchPlanner"/>).
/// </summary>
public sealed class ScorePatchParser : IScorePatchParser
{
    private const int MaxErrorLength = 200;

    private static readonly JsonDocumentOptions ParseOptions = new()
    {
        MaxDepth = ScoreLimits.MaxJsonDepth,
        AllowDuplicateProperties = false,
    };

    private readonly CompiledSchema _id;
    private readonly CompiledSchema _meta;
    private readonly CompiledSchema _measureInfo;
    private readonly CompiledSchema _staffMeasure;
    private readonly CompiledSchema _part;
    private readonly CompiledSchema _slurs;

    public ScorePatchParser()
    {
        CompiledSchema root = CompiledSchema.Compile(ScoreContentValidator.LoadSchema());
        _id = root.Definition("id");
        _meta = root.Property("meta");
        _measureInfo = root.Definition("measureInfo");
        _staffMeasure = root.Definition("staffMeasure");
        _part = root.Definition("part");
        _slurs = root.Property("slurs");
    }

    public ScorePatchParseResult Parse(ReadOnlyMemory<byte> utf8Json)
    {
        JsonDocument document;
        try
        {
            if (utf8Json.Span.StartsWith(new byte[] { 0xEF, 0xBB, 0xBF }) || !Utf8.IsValid(utf8Json.Span))
            {
                return Fail("The body must be UTF-8 JSON without a byte order mark.");
            }

            document = JsonDocument.Parse(utf8Json, ParseOptions);
        }
        catch (JsonException)
        {
            return Fail("The body is not valid JSON.");
        }

        using (document)
        {
            try
            {
                return Build(document.RootElement);
            }
            catch (PatchFormatException ex)
            {
                return Fail(ex.Message);
            }
        }
    }

    private ScorePatchParseResult Build(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new PatchFormatException("The patch must be a JSON object.");
        }

        JsonElement? ops = null;
        foreach (JsonProperty property in root.EnumerateObject())
        {
            if (property.Name != "ops")
            {
                throw new PatchFormatException($"Unknown property '{Short(property.Name)}' in the patch.");
            }

            ops = property.Value;
        }

        if (ops is not { ValueKind: JsonValueKind.Array } list || list.GetArrayLength() is < 1 or > ScoreLimits.MaxPatchOps)
        {
            throw new PatchFormatException($"ops must be an array of 1 to {ScoreLimits.MaxPatchOps} operations.");
        }

        List<ScorePatchOp> result = new(list.GetArrayLength());
        int index = 0;
        foreach (JsonElement op in list.EnumerateArray())
        {
            try
            {
                result.Add(ParseOp(op));
            }
            catch (PatchFormatException ex)
            {
                throw new PatchFormatException($"ops[{index}]: {ex.Message}");
            }

            index++;
        }

        return new ScorePatchParseResult(new ScorePatch(result), null);
    }

    private ScorePatchOp ParseOp(JsonElement op)
    {
        if (op.ValueKind != JsonValueKind.Object || !op.TryGetProperty("op", out JsonElement kind) || kind.ValueKind != JsonValueKind.String)
        {
            throw new PatchFormatException("an operation is an object with a string 'op'.");
        }

        switch (kind.GetString())
        {
            case "setMeta":
                Only(op, "op", "meta");
                return SetMeta(Required(op, "meta"));
            case "setMeasureInfo":
            {
                Only(op, "op", "measureId", "value");
                string id = Id(op, "measureId");
                JsonElement value = Valid(Required(op, "value"), _measureInfo, "value");
                SameId(value, id);
                return new SetMeasureInfoOp(id, value.GetRawText());
            }

            case "setStaffMeasure":
                Only(op, "op", "staffId", "measureId", "value");
                return new SetStaffMeasureOp(
                    Id(op, "staffId"), Id(op, "measureId"), Valid(Required(op, "value"), _staffMeasure, "value").GetRawText());
            case "insertMeasure":
                return InsertMeasure(op);
            case "deleteMeasure":
                Only(op, "op", "measureId");
                return new DeleteMeasureOp(Id(op, "measureId"));
            case "replacePart":
            {
                Only(op, "op", "partId", "value");
                string id = Id(op, "partId");
                JsonElement value = Valid(Required(op, "value"), _part, "value");
                SameId(value, id);
                return new ReplacePartOp(id, value.GetRawText(), Staves(value));
            }

            case "insertPart":
            {
                Only(op, "op", "index", "value");
                JsonElement value = Valid(Required(op, "value"), _part, "value");
                return new InsertPartOp(Index(op), value.GetProperty("id").GetString()!, value.GetRawText(), Staves(value));
            }

            case "deletePart":
                Only(op, "op", "partId");
                return new DeletePartOp(Id(op, "partId"));
            case "setSlurs":
                Only(op, "op", "slurs");
                return new SetSlursOp(Valid(Required(op, "slurs"), _slurs, "slurs").GetRawText());
            default:
                throw new PatchFormatException("unknown operation.");
        }
    }

    private SetMetaOp SetMeta(JsonElement meta)
    {
        Valid(meta, _meta, "meta");

        // The schema guarantees title is a string of at most 200 code points. Same rule as a full save.
        string raw = meta.GetProperty("title").GetString()!;
        string? title = ScoreTitle.TrySanitize(raw);
        if (string.IsNullOrEmpty(title))
        {
            throw new PatchFormatException("the title must be 1 to 200 characters, without control characters.");
        }

        string json = meta.GetRawText();
        if (title != raw)
        {
            JsonNode node = JsonNode.Parse(json)!;
            node["title"] = title;
            json = node.ToJsonString();
        }

        return new SetMetaOp(json, title);
    }

    private InsertMeasureOp InsertMeasure(JsonElement op)
    {
        Only(op, "op", "index", "info", "staffMeasures");
        JsonElement info = Valid(Required(op, "info"), _measureInfo, "info");
        JsonElement staffMeasures = Required(op, "staffMeasures");
        if (staffMeasures.ValueKind != JsonValueKind.Array || staffMeasures.GetArrayLength() is < 1 or > 128)
        {
            throw new PatchFormatException("staffMeasures must be an array with one entry per staff.");
        }

        List<StaffMeasureValue> values = new(staffMeasures.GetArrayLength());
        foreach (JsonElement entry in staffMeasures.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object)
            {
                throw new PatchFormatException("a staffMeasures entry is { staffId, value }.");
            }

            Only(entry, "staffId", "value");
            values.Add(new StaffMeasureValue(
                Id(entry, "staffId"), Valid(Required(entry, "value"), _staffMeasure, "value").GetRawText()));
        }

        return new InsertMeasureOp(Index(op), info.GetProperty("id").GetString()!, info.GetRawText(), values);
    }

    private static List<StaffShape> Staves(JsonElement part)
    {
        // The schema guarantees staves is an array of 1 to 4 staves, each with an id and a measures array.
        List<StaffShape> staves = [];
        foreach (JsonElement staff in part.GetProperty("staves").EnumerateArray())
        {
            staves.Add(new StaffShape(staff.GetProperty("id").GetString()!, staff.GetProperty("measures").GetArrayLength()));
        }

        return staves;
    }

    private static void SameId(JsonElement value, string id)
    {
        if (value.GetProperty("id").GetString() != id)
        {
            throw new PatchFormatException("the id of the value must be the id of the target.");
        }
    }

    private static int Index(JsonElement op)
    {
        JsonElement value = Required(op, "index");
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out int index) || index is < 0 or > 100_000)
        {
            throw new PatchFormatException("index must be a non-negative integer.");
        }

        return index;
    }

    private string Id(JsonElement op, string name)
    {
        JsonElement value = Required(op, name);
        if (!_id.IsValid(value, []))
        {
            throw new PatchFormatException($"{name} is not a valid id.");
        }

        return value.GetString()!;
    }

    private static JsonElement Valid(JsonElement value, CompiledSchema schema, string name)
    {
        List<string> path = [];
        if (!schema.IsValid(value, path))
        {
            path.Reverse();
            throw new PatchFormatException($"{name} does not match the score schema at '/{string.Join('/', path)}'.");
        }

        return value;
    }

    private static JsonElement Required(JsonElement op, string name) =>
        op.TryGetProperty(name, out JsonElement value) ? value : throw new PatchFormatException($"{name} is required.");

    private static void Only(JsonElement op, params string[] allowed)
    {
        foreach (JsonProperty property in op.EnumerateObject())
        {
            if (Array.IndexOf(allowed, property.Name) < 0)
            {
                throw new PatchFormatException($"unknown property '{Short(property.Name)}'.");
            }
        }
    }

    private static string Short(string text) => text.Length <= 32 ? text : text[..(char.IsHighSurrogate(text[31]) ? 31 : 32)];

    private static ScorePatchParseResult Fail(string error) =>
        new(null, error.Length <= MaxErrorLength ? error : error[..(char.IsHighSurrogate(error[MaxErrorLength - 1]) ? MaxErrorLength - 1 : MaxErrorLength)]);

    private sealed class PatchFormatException(string message) : Exception(message);
}
