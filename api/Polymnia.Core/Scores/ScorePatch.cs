namespace Polymnia.Core.Scores;

/// <summary>
/// One structural change of a stored score. Every operation replaces, inserts or deletes a whole unit (the score
/// metadata, a measure, one staff's measure, a part, the slur list) addressed by its stable id, so applying it twice
/// to the same base gives the same document (idempotent replacements) and a unit is never edited field by field.
/// The JSON strings are fragments already validated against the score schema (docs/api.md, "Incremental updates").
/// </summary>
public abstract record ScorePatchOp;

/// <summary>Replaces <c>meta</c>. <see cref="Title"/> is the sanitized title, also stored in the title column.</summary>
public sealed record SetMetaOp(string Json, string Title) : ScorePatchOp;

/// <summary>Replaces the <c>MeasureInfo</c> whose id is <see cref="MeasureId"/> (the value has the same id).</summary>
public sealed record SetMeasureInfoOp(string MeasureId, string Json) : ScorePatchOp;

/// <summary>Replaces the measure of one staff at the position of measure <see cref="MeasureId"/>.</summary>
public sealed record SetStaffMeasureOp(string StaffId, string MeasureId, string Json) : ScorePatchOp;

/// <summary>Inserts a measure at <see cref="Index"/>: its info and one staff measure for every staff of the score.</summary>
public sealed record InsertMeasureOp(
    int Index, string MeasureId, string InfoJson, IReadOnlyList<StaffMeasureValue> StaffMeasures) : ScorePatchOp;

/// <summary>Deletes a measure (its info and the measure of every staff).</summary>
public sealed record DeleteMeasureOp(string MeasureId) : ScorePatchOp;

/// <summary>Replaces a whole part (header, staves and their measures).</summary>
public sealed record ReplacePartOp(string PartId, string Json, IReadOnlyList<StaffShape> Staves) : ScorePatchOp;

/// <summary>Inserts a part at <see cref="Index"/>.</summary>
public sealed record InsertPartOp(int Index, string PartId, string Json, IReadOnlyList<StaffShape> Staves) : ScorePatchOp;

/// <summary>Deletes a part.</summary>
public sealed record DeletePartOp(string PartId) : ScorePatchOp;

/// <summary>Replaces the whole list of slurs.</summary>
public sealed record SetSlursOp(string Json) : ScorePatchOp;

/// <summary>The measure of one staff, as carried by <see cref="InsertMeasureOp"/>.</summary>
public sealed record StaffMeasureValue(string StaffId, string Json);

/// <summary>A staff as carried by a part value: its id and how many measures it holds.</summary>
public sealed record StaffShape(string Id, int MeasureCount);

/// <summary>A validated list of operations, applied in order to the version named by <c>If-Match</c>.</summary>
public sealed record ScorePatch(IReadOnlyList<ScorePatchOp> Ops);

/// <summary>Result of parsing and validating a raw patch body.</summary>
public sealed record ScorePatchParseResult(ScorePatch? Patch, string? Error)
{
    public bool IsValid => Patch is not null;
}

/// <summary>Parses a raw patch body: JSON syntax, operation shapes, and every fragment against the score schema.</summary>
public interface IScorePatchParser
{
    ScorePatchParseResult Parse(ReadOnlyMemory<byte> utf8Json);
}
