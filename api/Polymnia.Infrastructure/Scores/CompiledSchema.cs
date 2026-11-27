using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Polymnia.Infrastructure.Scores;

/// <summary>
/// A compiled, allocation-light evaluator for the subset of JSON Schema draft 2020-12 that
/// <c>schema/score.v1.schema.json</c> uses. General purpose validators take 150 to 300 ms on a 1 MB score
/// (measured, see docs/api.md), which breaks the 50 ms budget of the update endpoint; this one is several times faster.
/// <para>
/// Safety rule: a keyword that is not implemented makes loading fail, it is never silently ignored, so the
/// schema cannot grow a rule that this evaluator would skip. <c>ScoreSchemaConformanceTests</c> checks it against
/// an independent, complete implementation (LateApexEarlySpeed.Json.Schema) on valid and invalid documents.
/// </para>
/// </summary>
internal sealed class CompiledSchema
{
    private static readonly HashSet<string> Annotations = ["$schema", "$id", "title", "description", "$defs"];

    private enum Kind { None, Object, Array, String, Boolean, Null, Number, Integer }

    private sealed record PropertyEntry(string Name, byte[] Utf8Name, CompiledSchema Schema);

    private sealed record Scalar(JsonValueKind Kind, string? Text, decimal Number);

    private readonly Dictionary<string, CompiledSchema> _defs = new(StringComparer.Ordinal);

    private string? _refName;
    private CompiledSchema? _ref;
    private Kind _type;
    private Scalar[]? _enum;
    private Scalar? _const;
    private PropertyEntry[]? _properties;
    private byte[][]? _required;
    private bool _noAdditionalProperties;
    private CompiledSchema? _items;
    private int? _minItems, _maxItems, _minLength, _maxLength;
    private decimal? _minimum, _maximum, _multipleOf;
    private Regex? _pattern;
    private CompiledSchema[]? _oneOf;

    // oneOf where every option pins the same property to a constant: only the matching option can match.
    private byte[]? _discriminatorName;
    private Scalar?[]? _discriminatorValues;

    private CompiledSchema()
    {
    }

    /// <summary>Compiles a schema document. Throws <see cref="NotSupportedException"/> on an unsupported keyword.</summary>
    public static CompiledSchema Compile(string schemaJson)
    {
        using JsonDocument document = JsonDocument.Parse(schemaJson);
        CompiledSchema root = new();
        root.Load(document.RootElement);
        root.Resolve(root);
        return root;
    }

    /// <summary>
    /// Returns <c>true</c> when valid. Otherwise <paramref name="failurePath"/> holds the location of the failure,
    /// innermost segment first.
    /// </summary>
    public bool IsValid(JsonElement value, List<string> failurePath) => Check(value, failurePath);

    private static CompiledSchema Child(JsonElement schema)
    {
        CompiledSchema child = new();
        child.Load(schema);
        return child;
    }

    private void Load(JsonElement schema)
    {
        if (schema.ValueKind != JsonValueKind.Object)
        {
            throw new NotSupportedException("Boolean schemas are not supported.");
        }

        foreach (JsonProperty keyword in schema.EnumerateObject())
        {
            JsonElement v = keyword.Value;
            switch (keyword.Name)
            {
                case "type": _type = ParseType(v.GetString()); break;
                case "const": _const = ToScalar(v); break;
                case "enum": _enum = [.. v.EnumerateArray().Select(ToScalar)]; break;
                case "required": _required = [.. v.EnumerateArray().Select(static e => Encoding.UTF8.GetBytes(e.GetString()!))]; break;
                case "additionalProperties":
                    if (v.ValueKind != JsonValueKind.False)
                    {
                        throw new NotSupportedException("Only additionalProperties: false is supported.");
                    }

                    _noAdditionalProperties = true;
                    break;
                case "properties":
                    _properties = [.. v.EnumerateObject().Select(static p => new PropertyEntry(p.Name, Encoding.UTF8.GetBytes(p.Name), Child(p.Value)))];
                    break;
                case "items": _items = Child(v); break;
                case "oneOf": _oneOf = [.. v.EnumerateArray().Select(Child)]; break;
                case "minItems": _minItems = v.GetInt32(); break;
                case "maxItems": _maxItems = v.GetInt32(); break;
                case "minLength": _minLength = v.GetInt32(); break;
                case "maxLength": _maxLength = v.GetInt32(); break;
                case "minimum": _minimum = v.GetDecimal(); break;
                case "maximum": _maximum = v.GetDecimal(); break;
                case "multipleOf": _multipleOf = v.GetDecimal(); break;
                case "pattern": _pattern = CompilePattern(v.GetString()!); break;
                case "$ref":
                    string reference = v.GetString()!;
                    if (!reference.StartsWith("#/$defs/", StringComparison.Ordinal))
                    {
                        throw new NotSupportedException($"Unsupported $ref '{reference}'.");
                    }

                    _refName = reference["#/$defs/".Length..];
                    break;
                case "$defs":
                    foreach (JsonProperty def in v.EnumerateObject())
                    {
                        _defs[def.Name] = Child(def.Value);
                    }

                    break;
                default:
                    if (!Annotations.Contains(keyword.Name))
                    {
                        throw new NotSupportedException($"Unsupported schema keyword '{keyword.Name}'.");
                    }

                    break;
            }
        }
    }

    private static Regex CompilePattern(string pattern)
    {
        // JSON Schema (ECMAScript) '$' means end of input; in .NET it also matches before a final newline,
        // which would accept "id\n". \z is the strict equivalent.
        if (pattern.EndsWith('$') && !pattern.EndsWith("\\$", StringComparison.Ordinal))
        {
            pattern = string.Concat(pattern.AsSpan(0, pattern.Length - 1), "\\z");
        }

        return new Regex(pattern, RegexOptions.CultureInvariant | RegexOptions.Compiled, TimeSpan.FromMilliseconds(100));
    }

    private static Kind ParseType(string? type) => type switch
    {
        "object" => Kind.Object,
        "array" => Kind.Array,
        "string" => Kind.String,
        "boolean" => Kind.Boolean,
        "null" => Kind.Null,
        "number" => Kind.Number,
        "integer" => Kind.Integer,
        _ => throw new NotSupportedException($"Unsupported type '{type}'."),
    };

    private void Resolve(CompiledSchema root)
    {
        if (_refName is not null && !root._defs.TryGetValue(_refName, out _ref!))
        {
            throw new NotSupportedException($"Unresolvable $ref '#/$defs/{_refName}'.");
        }

        foreach (CompiledSchema child in Children())
        {
            child.Resolve(root);
        }

        if (_oneOf is not null)
        {
            DetectDiscriminator();
        }
    }

    private void DetectDiscriminator()
    {
        // Same property pinned by "const" (and required) in every option.
        string? name = null;
        Scalar?[] values = new Scalar?[_oneOf!.Length];
        for (int i = 0; i < _oneOf.Length; i++)
        {
            CompiledSchema option = _oneOf[i];
            PropertyEntry? pinned = option._properties?.FirstOrDefault(p =>
                p.Schema._const is not null
                && option._required is not null
                && option._required.Any(r => r.AsSpan().SequenceEqual(p.Utf8Name)));
            if (pinned is null || (name is not null && name != pinned.Name))
            {
                return;
            }

            name = pinned.Name;
            values[i] = pinned.Schema._const;
        }

        _discriminatorName = Encoding.UTF8.GetBytes(name!);
        _discriminatorValues = values;
    }

    private IEnumerable<CompiledSchema> Children()
    {
        foreach (CompiledSchema def in _defs.Values)
        {
            yield return def;
        }

        if (_properties is not null)
        {
            foreach (PropertyEntry p in _properties)
            {
                yield return p.Schema;
            }
        }

        if (_items is not null)
        {
            yield return _items;
        }

        if (_oneOf is not null)
        {
            foreach (CompiledSchema o in _oneOf)
            {
                yield return o;
            }
        }
    }

    private bool Check(JsonElement value, List<string> path)
    {
        if (_ref is not null && !_ref.Check(value, path))
        {
            return false;
        }

        if (_type != Kind.None && !TypeMatches(value))
        {
            return false;
        }

        if (_const is not null && !ScalarEquals(_const, value))
        {
            return false;
        }

        if (_enum is not null && !EnumContains(value))
        {
            return false;
        }

        bool ok = value.ValueKind switch
        {
            JsonValueKind.Number => CheckNumber(value),
            JsonValueKind.String => CheckString(value),
            JsonValueKind.Array => CheckArray(value, path),
            JsonValueKind.Object => CheckObject(value, path),
            _ => true,
        };

        return ok && (_oneOf is null || CheckOneOf(value, path));
    }

    private bool CheckOneOf(JsonElement value, List<string> path)
    {
        CompiledSchema[] options = _oneOf!;
        int depth = path.Count;
        int matches = 0;

        JsonElement discriminator = default;
        bool pinned = _discriminatorName is not null
            && value.ValueKind == JsonValueKind.Object
            && value.TryGetProperty(_discriminatorName, out discriminator);
        if (_discriminatorName is not null && !pinned)
        {
            // The pinned property is required by every option: none can match.
            return false;
        }

        for (int i = 0; i < options.Length; i++)
        {
            if (pinned && !ScalarEquals(_discriminatorValues![i], discriminator))
            {
                continue;
            }

            if (options[i].Check(value, path))
            {
                matches++;
            }

            // A failure inside an option is not a failure of the whole: drop its location.
            path.RemoveRange(depth, path.Count - depth);
        }

        return matches == 1;
    }

    private bool TypeMatches(JsonElement value) => _type switch
    {
        Kind.Object => value.ValueKind == JsonValueKind.Object,
        Kind.Array => value.ValueKind == JsonValueKind.Array,
        Kind.String => value.ValueKind == JsonValueKind.String,
        Kind.Boolean => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
        Kind.Null => value.ValueKind == JsonValueKind.Null,
        Kind.Number => value.ValueKind == JsonValueKind.Number,
        _ => value.ValueKind == JsonValueKind.Number && IsInteger(value),
    };

    private static bool IsInteger(JsonElement value) =>
        value.TryGetInt64(out _) || (value.TryGetDecimal(out decimal d) && d == decimal.Truncate(d));

    private bool CheckNumber(JsonElement value)
    {
        if (_minimum is null && _maximum is null && _multipleOf is null)
        {
            return true;
        }

        decimal d;
        if (value.TryGetInt64(out long l))
        {
            d = l;
        }
        else if (!value.TryGetDecimal(out d))
        {
            return false;
        }

        return (_minimum is not { } min || d >= min)
            && (_maximum is not { } max || d <= max)
            && (_multipleOf is not { } step || d % step == 0);
    }

    private bool CheckString(JsonElement value)
    {
        if (_minLength is null && _maxLength is null && _pattern is null)
        {
            return true;
        }

        string text = value.GetString()!;
        if (_minLength is not null || _maxLength is not null)
        {
            // Length is counted in Unicode code points; the UTF-16 length is an upper bound that avoids the scan.
            int length = text.Length;
            if (_minLength is not null || length > (_maxLength ?? int.MaxValue))
            {
                length = CountCodePoints(text);
            }

            if (length < (_minLength ?? 0) || length > (_maxLength ?? int.MaxValue))
            {
                return false;
            }
        }

        return _pattern is null || _pattern.IsMatch(text);
    }

    private static int CountCodePoints(string text)
    {
        int count = 0;
        foreach (Rune _ in text.EnumerateRunes())
        {
            count++;
        }

        return count;
    }

    private bool CheckArray(JsonElement value, List<string> path)
    {
        if (_minItems is not null || _maxItems is not null)
        {
            int length = value.GetArrayLength();
            if (length < (_minItems ?? 0) || length > (_maxItems ?? int.MaxValue))
            {
                return false;
            }
        }

        if (_items is null)
        {
            return true;
        }

        int index = 0;
        foreach (JsonElement item in value.EnumerateArray())
        {
            if (!_items.Check(item, path))
            {
                path.Add(index.ToString(CultureInfo.InvariantCulture));
                return false;
            }

            index++;
        }

        return true;
    }

    private bool CheckObject(JsonElement value, List<string> path)
    {
        if (_required is not null)
        {
            foreach (byte[] name in _required)
            {
                if (!value.TryGetProperty(name, out _))
                {
                    return false;
                }
            }
        }

        if (_properties is null && !_noAdditionalProperties)
        {
            return true;
        }

        foreach (JsonProperty property in value.EnumerateObject())
        {
            PropertyEntry? entry = Find(property);
            if (entry is not null)
            {
                if (!entry.Schema.Check(property.Value, path))
                {
                    path.Add(entry.Name);
                    return false;
                }
            }
            else if (_noAdditionalProperties)
            {
                path.Add(property.Name);
                return false;
            }
        }

        return true;
    }

    private PropertyEntry? Find(JsonProperty property)
    {
        if (_properties is null)
        {
            return null;
        }

        foreach (PropertyEntry entry in _properties)
        {
            if (property.NameEquals(entry.Utf8Name))
            {
                return entry;
            }
        }

        return null;
    }

    private static Scalar ToScalar(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Object or JsonValueKind.Array => throw new NotSupportedException("const and enum only support scalar values."),
        JsonValueKind.String => new Scalar(JsonValueKind.String, value.GetString(), 0),
        JsonValueKind.Number => new Scalar(JsonValueKind.Number, null, value.GetDecimal()),
        _ => new Scalar(value.ValueKind, null, 0),
    };

    private bool EnumContains(JsonElement value)
    {
        foreach (Scalar candidate in _enum!)
        {
            if (ScalarEquals(candidate, value))
            {
                return true;
            }
        }

        return false;
    }

    private static bool ScalarEquals(Scalar? expected, JsonElement actual)
    {
        if (expected is null || expected.Kind != actual.ValueKind)
        {
            // true and false are distinct kinds in JsonElement and are never equal to each other.
            return false;
        }

        return expected.Kind switch
        {
            JsonValueKind.String => actual.ValueEquals(expected.Text),
            JsonValueKind.Number => actual.TryGetDecimal(out decimal d) && d == expected.Number,
            _ => true,
        };
    }
}
