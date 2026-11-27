using System.Text;
using Polymnia.Core.Scores;
using Polymnia.Infrastructure.Scores;

namespace Polymnia.Tests;

/// <summary>The patch parser and planner without a database: what a patch means, and what it must never allow.</summary>
public sealed class ScorePatchPlannerTests
{
    private static readonly ScorePatchParser Parser = new();

    private const string Rest = """{"voices":[{"id":"v","events":[{"kind":"rest","id":"r","duration":{"base":"whole","dots":0}}],"tuplets":[]}]}""";

    private static ScorePatch Parse(string json)
    {
        ScorePatchParseResult result = Parser.Parse(Encoding.UTF8.GetBytes(json));
        Assert.True(result.IsValid, result.Error);
        return result.Patch!;
    }

    private static string Error(string json)
    {
        ScorePatchParseResult result = Parser.Parse(Encoding.UTF8.GetBytes(json));
        Assert.False(result.IsValid);
        return result.Error!;
    }

    // Two parts: p1 with staves s1 and s2, p2 with s3; three measures.
    private static ScoreShape Shape()
    {
        return ScoreShape.FromJson(
            """["m1","m2","m3"]""", """["p1","p2"]""", "[2,1]", """["s1","s2","s3"]""", "[3,3,3]");
    }

    [Fact]
    public void Operations_see_the_effect_of_the_ones_before_them()
    {
        ScoreShape shape = Shape();
        ScorePatch patch = Parse($$$"""
            {"ops":[
              {"op":"deleteMeasure","measureId":"m1"},
              {"op":"insertMeasure","index":0,"info":{"id":"n1"},"staffMeasures":[
                 {"staffId":"s1","value":{{{Rest}}}},{"staffId":"s2","value":{{{Rest}}}},{"staffId":"s3","value":{{{Rest}}}}]},
              {"op":"setStaffMeasure","staffId":"s3","measureId":"n1","value":{{{Rest}}}},
              {"op":"setMeasureInfo","measureId":"m3","value":{"id":"m3","keyFifths":1}}
            ]}
            """);

        PatchPlan plan = ScorePatchPlanner.Plan(shape, patch);

        Assert.True(plan.IsValid, plan.Error);
        // delete: 1 + 3 staves, insert: 1 + 3 staves, then 2 replacements.
        Assert.Equal(10, plan.Edits.Count);
        Assert.Equal(["measures", "0"], plan.Edits[0].Path);
        Assert.Equal(EditKind.Delete, plan.Edits[0].Kind);
        Assert.Equal(EditKind.Insert, plan.Edits[4].Kind);
        Assert.Equal(["measures", "0"], plan.Edits[4].Path);
        Assert.Equal(["parts", "1", "staves", "0", "measures", "0"], plan.Edits[8].Path);
        Assert.Equal(["measures", "2"], plan.Edits[9].Path);
        Assert.Equal(["n1", "m2", "m3"], shape.Measures);
    }

    [Fact]
    public void Appending_inserts_after_the_last_element()
    {
        ScorePatch patch = Parse($$$"""
            {"ops":[{"op":"insertMeasure","index":3,"info":{"id":"n1"},"staffMeasures":[
              {"staffId":"s1","value":{{{Rest}}}},{"staffId":"s2","value":{{{Rest}}}},{"staffId":"s3","value":{{{Rest}}}}]}]}
            """);

        PatchPlan plan = ScorePatchPlanner.Plan(Shape(), patch);

        Assert.All(plan.Edits, e => Assert.Equal(EditKind.InsertAfter, e.Kind));
        Assert.Equal(["measures", "2"], plan.Edits[0].Path);
    }

    [Theory]
    [InlineData("""{"op":"insertMeasure","index":4,"info":{"id":"n"},"staffMeasures":[{"staffId":"s1","value":REST},{"staffId":"s2","value":REST},{"staffId":"s3","value":REST}]}""")]
    [InlineData("""{"op":"insertMeasure","index":0,"info":{"id":"m2"},"staffMeasures":[{"staffId":"s1","value":REST},{"staffId":"s2","value":REST},{"staffId":"s3","value":REST}]}""")]
    [InlineData("""{"op":"insertMeasure","index":0,"info":{"id":"n"},"staffMeasures":[{"staffId":"s1","value":REST},{"staffId":"s2","value":REST}]}""")]
    [InlineData("""{"op":"insertMeasure","index":0,"info":{"id":"n"},"staffMeasures":[{"staffId":"s1","value":REST},{"staffId":"s1","value":REST},{"staffId":"s3","value":REST}]}""")]
    [InlineData("""{"op":"insertMeasure","index":0,"info":{"id":"n"},"staffMeasures":[{"staffId":"s1","value":REST},{"staffId":"s2","value":REST},{"staffId":"zz","value":REST}]}""")]
    [InlineData("""{"op":"setStaffMeasure","staffId":"s9","measureId":"m1","value":REST}""")]
    [InlineData("""{"op":"setMeasureInfo","measureId":"zz","value":{"id":"zz"}}""")]
    [InlineData("""{"op":"deletePart","partId":"zz"}""")]
    public void Impossible_operations_are_refused(string op)
    {
        ScorePatch patch = Parse("{\"ops\":[" + op.Replace("REST", Rest, StringComparison.Ordinal) + "]}");

        PatchPlan plan = ScorePatchPlanner.Plan(Shape(), patch);

        Assert.False(plan.IsValid);
    }

    [Fact]
    public void The_last_measure_and_the_last_part_cannot_be_deleted()
    {
        ScoreShape shape = ScoreShape.FromJson("""["m1"]""", """["p1"]""", "[1]", """["s1"]""", "[1]");

        Assert.False(ScorePatchPlanner.Plan(shape, Parse("""{"ops":[{"op":"deleteMeasure","measureId":"m1"}]}""")).IsValid);
        Assert.False(ScorePatchPlanner.Plan(shape, Parse("""{"ops":[{"op":"deletePart","partId":"p1"}]}""")).IsValid);
    }

    [Fact]
    public void The_array_limits_of_the_schema_hold()
    {
        string[] measures = [.. Enumerable.Range(1, 2000).Select(i => $"\"m{i}\"")];
        ScoreShape full = ScoreShape.FromJson("[" + string.Join(',', measures) + "]", """["p1"]""", "[1]", """["s1"]""", "[2000]");
        string[] parts = [.. Enumerable.Range(1, 32).Select(i => $"\"p{i}\"")];
        string[] staves = [.. Enumerable.Range(1, 32).Select(i => $"\"s{i}\"")];
        ScoreShape manyParts = ScoreShape.FromJson(
            """["m1"]""", "[" + string.Join(',', parts) + "]", "[" + string.Join(',', Enumerable.Repeat(1, 32)) + "]",
            "[" + string.Join(',', staves) + "]", "[" + string.Join(',', Enumerable.Repeat(1, 32)) + "]");

        ScorePatch addMeasure = Parse($$$"""{"ops":[{"op":"insertMeasure","index":0,"info":{"id":"n"},"staffMeasures":[{"staffId":"s1","value":{{{Rest}}}}]}]}""");
        string newPart = $$$"""{"id":"pn","name":"x","instrument":"piano","transposition":0,"staves":[{"id":"sn","clef":"treble","type":"standard","measures":[{{{Rest}}}]}]}""";
        ScorePatch addPart = Parse("{\"ops\":[{\"op\":\"insertPart\",\"index\":0,\"value\":" + newPart + "}]}");

        Assert.False(ScorePatchPlanner.Plan(full, addMeasure).IsValid);
        Assert.False(ScorePatchPlanner.Plan(manyParts, addPart).IsValid);
    }

    [Fact]
    public void A_stored_score_that_reuses_ids_cannot_be_patched()
    {
        ScoreShape duplicateMeasures = ScoreShape.FromJson("""["m1","m1"]""", """["p1"]""", "[1]", """["s1"]""", "[2]");
        ScoreShape duplicateStaves = ScoreShape.FromJson("""["m1"]""", """["p1","p2"]""", "[1,1]", """["s1","s1"]""", "[1,1]");
        ScoreShape ragged = ScoreShape.FromJson("""["m1","m2"]""", """["p1"]""", "[1]", """["s1"]""", "[1]");
        ScorePatch patch = Parse("""{"ops":[{"op":"setSlurs","slurs":[]}]}""");

        Assert.False(ScorePatchPlanner.Plan(duplicateMeasures, patch).IsValid);
        Assert.False(ScorePatchPlanner.Plan(duplicateStaves, patch).IsValid);
        Assert.False(ScorePatchPlanner.Plan(ragged, patch).IsValid);
    }

    [Fact]
    public void Replacing_a_part_keeps_the_shape_in_step_with_the_document()
    {
        ScoreShape shape = Shape();
        string part = $$$"""
            {"id":"p2","name":"x","instrument":"piano","transposition":0,"staves":[
            {"id":"t1","clef":"treble","type":"standard","measures":[{{{Rest}}},{{{Rest}}},{{{Rest}}}]},
            {"id":"t2","clef":"bass","type":"standard","measures":[{{{Rest}}},{{{Rest}}},{{{Rest}}}]}]}
            """;

        PatchPlan plan = ScorePatchPlanner.Plan(shape, Parse("{\"ops\":[{\"op\":\"replacePart\",\"partId\":\"p2\",\"value\":" + part + "},"
            + $$$"""{"op":"setStaffMeasure","staffId":"t2","measureId":"m1","value":{{{Rest}}}}]}"""));

        Assert.True(plan.IsValid, plan.Error);
        Assert.Equal(["parts", "1", "staves", "1", "measures", "0"], plan.Edits[1].Path);
        Assert.Equal(2, shape.Parts[1].Staves.Count);
    }

    [Fact]
    public void A_patch_that_needs_too_many_edits_is_refused()
    {
        string insert = $$$"""{"op":"insertMeasure","index":0,"info":{"id":"nID"},"staffMeasures":[{"staffId":"s1","value":{{{Rest}}}},{"staffId":"s2","value":{{{Rest}}}},{"staffId":"s3","value":{{{Rest}}}}]}""";
        string ops = string.Join(',', Enumerable.Range(0, 20).Select(i => insert.Replace("nID", "n" + i, StringComparison.Ordinal)));

        PatchPlan plan = ScorePatchPlanner.Plan(Shape(), Parse("{\"ops\":[" + ops + "]}"));

        Assert.False(plan.IsValid);
        Assert.Contains("edits", plan.Error, StringComparison.Ordinal);
    }

    [Fact]
    public void The_title_of_the_last_setMeta_wins_and_is_sanitized()
    {
        ScorePatch patch = Parse("""
            {"ops":[{"op":"setMeta","meta":{"title":"first","composer":"","tempoBpm":100}},
                    {"op":"setMeta","meta":{"title":"  second  ","composer":"","tempoBpm":100}}]}
            """);

        PatchPlan plan = ScorePatchPlanner.Plan(Shape(), patch);

        Assert.Equal("second", plan.Title);
        Assert.Contains("\"second\"", ((SetMetaOp)patch.Ops[1]).Json, StringComparison.Ordinal);
    }

    [Fact]
    public void The_parser_is_strict()
    {
        Assert.Contains("ops", Error("""{"ops":[]}"""), StringComparison.Ordinal);
        Assert.Contains("unknown property", Error("""{"ops":[{"op":"deletePart","partId":"p","extra":1}]}"""), StringComparison.Ordinal);
        Assert.Contains("partId", Error("""{"ops":[{"op":"deletePart"}]}"""), StringComparison.Ordinal);
        Assert.Contains("ops[1]", Error("""{"ops":[{"op":"deletePart","partId":"p"},{"op":"nope"}]}"""), StringComparison.Ordinal);
        Assert.Contains("not valid JSON", Error("""{"ops":[],"ops":[]}"""), StringComparison.Ordinal);
        Assert.Contains("ops[0]", Error("""{"ops":[{"op":"insertPart","index":1.5,"value":{}}]}"""), StringComparison.Ordinal);
        // Nesting beyond the depth limit.
        Assert.Contains("not valid JSON", Error("{\"ops\":[{\"op\":\"setSlurs\",\"slurs\":" + new string('[', 40) + new string(']', 40) + "}]}"), StringComparison.Ordinal);
    }

    [Fact]
    public void The_error_message_stays_short()
    {
        string message = Error("{\"ops\":[{\"op\":\"deletePart\",\"partId\":\"p\",\"" + new string('x', 500) + "\":1}]}");

        Assert.True(message.Length <= 200);
    }
}
