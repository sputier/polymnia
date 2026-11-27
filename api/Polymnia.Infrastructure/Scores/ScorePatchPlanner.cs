using System.Text.Json;
using Polymnia.Core.Scores;

namespace Polymnia.Infrastructure.Scores;

/// <summary>What the planner needs to know about the stored document: ids and counts, never the content.</summary>
internal sealed class ScoreShape
{
    public List<string> Measures { get; } = [];

    public List<PartShape> Parts { get; } = [];

    /// <summary>
    /// Reads the shape from the small JSON arrays PostgreSQL extracts from the stored document (<see cref="ScoreStore"/>):
    /// measure ids, part ids, the number of staves of each part, then the id and measure count of every staff in order.
    /// </summary>
    public static ScoreShape FromJson(string measures, string partIds, string staffCounts, string staffIds, string staffMeasureCounts)
    {
        ScoreShape shape = new();
        shape.Measures.AddRange(Strings(measures));
        string[] parts = [.. Strings(partIds)];
        int[] counts = [.. Numbers(staffCounts)];
        string[] ids = [.. Strings(staffIds)];
        int[] measureCounts = [.. Numbers(staffMeasureCounts)];
        if (parts.Length != counts.Length || ids.Length != measureCounts.Length || counts.Sum() != ids.Length)
        {
            throw new InvalidOperationException("The stored score does not have the shape the schema requires.");
        }

        int staff = 0;
        for (int p = 0; p < parts.Length; p++)
        {
            PartShape part = new(parts[p]);
            for (int s = 0; s < counts[p]; s++, staff++)
            {
                part.Staves.Add(new StaffShape(ids[staff], measureCounts[staff]));
            }

            shape.Parts.Add(part);
        }

        return shape;
    }

    private static IEnumerable<string> Strings(string json)
    {
        using JsonDocument document = JsonDocument.Parse(json);
        return [.. document.RootElement.EnumerateArray().Select(e => e.GetString() ?? string.Empty)];
    }

    private static IEnumerable<int> Numbers(string json)
    {
        using JsonDocument document = JsonDocument.Parse(json);
        return [.. document.RootElement.EnumerateArray().Select(e => e.GetInt32())];
    }
}

internal sealed class PartShape(string id)
{
    public string Id { get; } = id;

    public List<StaffShape> Staves { get; } = [];
}

internal enum EditKind { Set, Insert, InsertAfter, Delete }

/// <summary>One jsonb edit: a path into the stored document and, except for a delete, the fragment to put there.</summary>
internal sealed record Edit(EditKind Kind, string[] Path, string? Json);

internal sealed record PatchPlan(IReadOnlyList<Edit> Edits, string? Title, string? Error)
{
    public bool IsValid => Error is null;
}

/// <summary>
/// Turns a validated patch into the list of jsonb edits that apply it to the stored document, using only the shape of
/// that document (ids and counts). It simulates the shape as it goes, so later operations see the effect of earlier
/// ones. It refuses everything that would leave a document a full save would reject (the array limits of the schema),
/// or an ambiguous one (a duplicated id cannot be addressed), or an inconsistent one (a staff that does not have
/// one measure per measure of the score).
/// </summary>
internal static class ScorePatchPlanner
{
    private const int MaxMeasures = 2000;
    private const int MaxParts = 32;

    public static PatchPlan Plan(ScoreShape shape, ScorePatch patch)
    {
        string? error = CheckShape(shape);
        if (error is not null)
        {
            return Fail(error);
        }

        List<Edit> edits = [];
        string? title = null;
        foreach (ScorePatchOp op in patch.Ops)
        {
            error = Apply(shape, op, edits, ref title);
            if (error is not null)
            {
                return Fail(error);
            }

            if (edits.Count > ScoreLimits.MaxPatchEdits)
            {
                return Fail($"The patch needs more than {ScoreLimits.MaxPatchEdits} edits; send the full document.");
            }
        }

        return new PatchPlan(edits, title, null);
    }

    private static PatchPlan Fail(string error) => new([], null, error);

    private static string? CheckShape(ScoreShape shape)
    {
        // Ids are the addresses of a patch: a duplicate would make it ambiguous.
        if (shape.Measures.Distinct(StringComparer.Ordinal).Count() != shape.Measures.Count
            || shape.Parts.Select(p => p.Id).Distinct(StringComparer.Ordinal).Count() != shape.Parts.Count
            || AllStaves(shape).Select(s => s.Id).Distinct(StringComparer.Ordinal).Count() != AllStaves(shape).Count())
        {
            return "The stored score reuses an id for several measures, parts or staves: send the full document.";
        }

        if (AllStaves(shape).Any(s => s.MeasureCount != shape.Measures.Count))
        {
            return "The stored score has a staff without one measure per measure: send the full document.";
        }

        return null;
    }

    private static IEnumerable<StaffShape> AllStaves(ScoreShape shape) => shape.Parts.SelectMany(p => p.Staves);

    private static string? Apply(ScoreShape shape, ScorePatchOp op, List<Edit> edits, ref string? title)
    {
        switch (op)
        {
            case SetMetaOp meta:
                edits.Add(new Edit(EditKind.Set, ["meta"], meta.Json));
                title = meta.Title;
                return null;

            case SetMeasureInfoOp info:
            {
                int m = shape.Measures.IndexOf(info.MeasureId);
                if (m < 0)
                {
                    return "setMeasureInfo: unknown measure id.";
                }

                edits.Add(new Edit(EditKind.Set, ["measures", Str(m)], info.Json));
                return null;
            }

            case SetStaffMeasureOp set:
            {
                int m = shape.Measures.IndexOf(set.MeasureId);
                if (m < 0)
                {
                    return "setStaffMeasure: unknown measure id.";
                }

                if (!TryFindStaff(shape, set.StaffId, out int p, out int s))
                {
                    return "setStaffMeasure: unknown staff id.";
                }

                edits.Add(new Edit(EditKind.Set, ["parts", Str(p), "staves", Str(s), "measures", Str(m)], set.Json));
                return null;
            }

            case InsertMeasureOp insert:
                return InsertMeasure(shape, insert, edits);

            case DeleteMeasureOp delete:
                return DeleteMeasure(shape, delete, edits);

            case ReplacePartOp replace:
            {
                int p = shape.Parts.FindIndex(x => x.Id == replace.PartId);
                if (p < 0)
                {
                    return "replacePart: unknown part id.";
                }

                string? error = CheckStaves(shape, replace.Staves, except: p);
                if (error is not null)
                {
                    return "replacePart: " + error;
                }

                edits.Add(new Edit(EditKind.Set, ["parts", Str(p)], replace.Json));
                shape.Parts[p] = ToShape(replace.PartId, replace.Staves);
                return null;
            }

            case InsertPartOp insertPart:
            {
                if (shape.Parts.Count >= MaxParts || insertPart.Index > shape.Parts.Count)
                {
                    return "insertPart: the part limit is reached or the index is out of range.";
                }

                if (shape.Parts.Any(x => x.Id == insertPart.PartId))
                {
                    return "insertPart: the part id is already used.";
                }

                string? error = CheckStaves(shape, insertPart.Staves, except: -1);
                if (error is not null)
                {
                    return "insertPart: " + error;
                }

                edits.Add(InsertEdit(["parts"], insertPart.Index, shape.Parts.Count, insertPart.Json));
                shape.Parts.Insert(insertPart.Index, ToShape(insertPart.PartId, insertPart.Staves));
                return null;
            }

            case DeletePartOp delete:
            {
                int p = shape.Parts.FindIndex(x => x.Id == delete.PartId);
                if (p < 0)
                {
                    return "deletePart: unknown part id.";
                }

                if (shape.Parts.Count == 1)
                {
                    return "deletePart: the last part cannot be deleted.";
                }

                edits.Add(new Edit(EditKind.Delete, ["parts", Str(p)], null));
                shape.Parts.RemoveAt(p);
                return null;
            }

            case SetSlursOp slurs:
                edits.Add(new Edit(EditKind.Set, ["slurs"], slurs.Json));
                return null;

            default:
                return "Unsupported operation.";
        }
    }

    private static string? InsertMeasure(ScoreShape shape, InsertMeasureOp op, List<Edit> edits)
    {
        if (shape.Measures.Count >= MaxMeasures || op.Index > shape.Measures.Count)
        {
            return "insertMeasure: the measure limit is reached or the index is out of range.";
        }

        if (shape.Measures.Contains(op.MeasureId))
        {
            return "insertMeasure: the measure id is already used.";
        }

        // One measure for every staff, each staff exactly once.
        Dictionary<string, string> byStaff = [];
        foreach (StaffMeasureValue value in op.StaffMeasures)
        {
            if (!byStaff.TryAdd(value.StaffId, value.Json))
            {
                return "insertMeasure: a staff appears twice.";
            }
        }

        if (byStaff.Count != AllStaves(shape).Count() || AllStaves(shape).Any(s => !byStaff.ContainsKey(s.Id)))
        {
            return "insertMeasure: staffMeasures must hold one measure for every staff of the score.";
        }

        edits.Add(InsertEdit(["measures"], op.Index, shape.Measures.Count, op.InfoJson));
        for (int p = 0; p < shape.Parts.Count; p++)
        {
            PartShape part = shape.Parts[p];
            for (int s = 0; s < part.Staves.Count; s++)
            {
                StaffShape staff = part.Staves[s];
                edits.Add(InsertEdit(["parts", Str(p), "staves", Str(s), "measures"], op.Index, staff.MeasureCount, byStaff[staff.Id]));
                part.Staves[s] = staff with { MeasureCount = staff.MeasureCount + 1 };
            }
        }

        shape.Measures.Insert(op.Index, op.MeasureId);
        return null;
    }

    private static string? DeleteMeasure(ScoreShape shape, DeleteMeasureOp op, List<Edit> edits)
    {
        int m = shape.Measures.IndexOf(op.MeasureId);
        if (m < 0)
        {
            return "deleteMeasure: unknown measure id.";
        }

        if (shape.Measures.Count == 1)
        {
            return "deleteMeasure: the last measure cannot be deleted.";
        }

        edits.Add(new Edit(EditKind.Delete, ["measures", Str(m)], null));
        for (int p = 0; p < shape.Parts.Count; p++)
        {
            PartShape part = shape.Parts[p];
            for (int s = 0; s < part.Staves.Count; s++)
            {
                edits.Add(new Edit(EditKind.Delete, ["parts", Str(p), "staves", Str(s), "measures", Str(m)], null));
                part.Staves[s] = part.Staves[s] with { MeasureCount = part.Staves[s].MeasureCount - 1 };
            }
        }

        shape.Measures.RemoveAt(m);
        return null;
    }

    // A staff must have one measure per measure of the score, and its id must not collide with another part's staff.
    private static string? CheckStaves(ScoreShape shape, IReadOnlyList<StaffShape> staves, int except)
    {
        HashSet<string> seen = [];
        for (int p = 0; p < shape.Parts.Count; p++)
        {
            if (p != except)
            {
                seen.UnionWith(shape.Parts[p].Staves.Select(s => s.Id));
            }
        }

        foreach (StaffShape staff in staves)
        {
            if (!seen.Add(staff.Id))
            {
                return "a staff id is already used.";
            }

            if (staff.MeasureCount != shape.Measures.Count)
            {
                return "every staff must have one measure for every measure of the score.";
            }
        }

        return null;
    }

    private static PartShape ToShape(string id, IReadOnlyList<StaffShape> staves)
    {
        PartShape part = new(id);
        part.Staves.AddRange(staves);
        return part;
    }

    // jsonb_insert puts the value before the element at the path; to append, insert after the last element.
    private static Edit InsertEdit(string[] arrayPath, int index, int count, string json)
    {
        return index < count
            ? new Edit(EditKind.Insert, [.. arrayPath, Str(index)], json)
            : new Edit(EditKind.InsertAfter, [.. arrayPath, Str(count - 1)], json);
    }

    private static bool TryFindStaff(ScoreShape shape, string id, out int part, out int staff)
    {
        for (part = 0; part < shape.Parts.Count; part++)
        {
            staff = shape.Parts[part].Staves.FindIndex(s => s.Id == id);
            if (staff >= 0)
            {
                return true;
            }
        }

        staff = -1;
        return false;
    }

    private static string Str(int value) => value.ToString(System.Globalization.CultureInfo.InvariantCulture);
}
