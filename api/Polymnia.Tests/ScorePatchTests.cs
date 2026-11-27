using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Polymnia.Core.Scores;

namespace Polymnia.Tests;

/// <summary>
/// <c>PATCH /api/scores/{id}/content</c> against a real PostgreSQL: every operation, rejected patches, access control,
/// concurrency, and the equivalence with full saves (seeded random edit sequences).
/// </summary>
public sealed class ScorePatchTests(ScoreApiFixture fixture) : IClassFixture<ScoreApiFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly string Small = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "score-small.json"));
    private static readonly string Big = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "score-500-measures.json"));

    private async Task<HttpClient> SignedInAsync(bool sendToken = true)
    {
        fixture.Postgres.SkipIfUnavailable();
        return await ScoreTestClients.SignInAsync(fixture.App, sendToken);
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private static async Task<(Guid Id, string ETag)> CreateAsync(HttpClient client, string? json = null)
    {
        using HttpResponseMessage created = await client.PostAsync("/api/scores", Json(json ?? Small), Ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        JsonNode body = (await JsonNode.ParseAsync(await created.Content.ReadAsStreamAsync(Ct), cancellationToken: Ct))!;
        return (body["id"]!.GetValue<Guid>(), created.Headers.ETag!.Tag);
    }

    private static async Task<(JsonNode Doc, string ETag)> GetAsync(HttpClient client, Guid id)
    {
        using HttpResponseMessage response = await client.GetAsync($"/api/scores/{id}", Ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return ((await JsonNode.ParseAsync(await response.Content.ReadAsStreamAsync(Ct), cancellationToken: Ct))!, response.Headers.ETag!.Tag);
    }

    private static HttpRequestMessage PatchRequest(Guid id, string? etag, string body, bool gzip = false)
    {
        HttpContent content;
        if (gzip)
        {
            using MemoryStream buffer = new();
            using (GZipStream zip = new(buffer, CompressionLevel.Fastest, leaveOpen: true))
            {
                zip.Write(Encoding.UTF8.GetBytes(body));
            }

            content = new ByteArrayContent(buffer.ToArray());
            content.Headers.ContentType = new("application/json");
            content.Headers.ContentEncoding.Add("gzip");
        }
        else
        {
            content = Json(body);
        }

        HttpRequestMessage request = new(HttpMethod.Patch, $"/api/scores/{id}/content") { Content = content };
        if (etag is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", etag);
        }

        return request;
    }

    private static string Ops(params JsonNode[] ops) => new JsonObject { ["ops"] = new JsonArray(ops) }.ToJsonString();

    private static async Task<HttpResponseMessage> PatchAsync(HttpClient client, Guid id, string etag, params JsonNode[] ops) =>
        await client.SendAsync(PatchRequest(id, etag, Ops(ops)), Ct);

    /// <summary>Patches and returns the new ETag; fails the test unless the answer is 200.</summary>
    private static async Task<string> PatchOkAsync(HttpClient client, Guid id, string etag, params JsonNode[] ops)
    {
        using HttpResponseMessage response = await PatchAsync(client, id, etag, ops);
        Assert.True(response.StatusCode == HttpStatusCode.OK, $"{response.StatusCode}: {await response.Content.ReadAsStringAsync(Ct)}");
        return response.Headers.ETag!.Tag;
    }

    private static JsonNode Parse(string json) => JsonNode.Parse(json)!;

    // ---- operations ------------------------------------------------------------------------------------------

    [Fact]
    public async Task Every_operation_gives_the_same_document_as_the_reference_model()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);
        JsonNode expected = Parse(Small);
        Gen gen = new(1);

        // Built one at a time: each operation is generated from the document the previous ones produced.
        Func<JsonNode>[] steps =
        [
            () => gen.SetMeta(expected),
            () => gen.SetMeasureInfo(expected, "m2"),
            () => gen.SetStaffMeasure(expected, "s3", "m3"),
            () => gen.InsertMeasure(expected, 0),
            () => gen.InsertMeasure(expected, 2),
            () => gen.InsertMeasure(expected, 6),
            () => Gen.DeleteMeasure("m1"),
            () => gen.SetSlurs(),
            () => gen.ReplacePart(expected, "p2"),
            () => gen.InsertPart(expected, 1),
            () => Gen.DeletePart("p1"),
        ];
        foreach (Func<JsonNode> make in steps)
        {
            JsonNode step = make();
            Gen.ApplyReference(expected, step);
            etag = await PatchOkAsync(client, id, etag, step.DeepClone());
            (JsonNode stored, string current) = await GetAsync(client, id);
            Assert.Equal(etag, current);
            Assert.True(JsonNode.DeepEquals(expected, stored), $"after {step["op"]}: expected {expected.ToJsonString()} but stored {stored.ToJsonString()}");
        }
    }

    [Fact]
    public async Task A_batch_of_operations_is_applied_in_order_with_later_ones_seeing_earlier_ones()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);
        JsonNode expected = Parse(Small);
        Gen gen = new(2);

        // Delete the first measure, insert one at its place, then replace a staff measure of the new one.
        JsonNode delete = Gen.DeleteMeasure("m1");
        JsonNode insert = gen.InsertMeasure(expected, 0);
        Gen.ApplyReference(expected, delete);
        Gen.ApplyReference(expected, insert);
        string newId = insert["info"]!["id"]!.GetValue<string>();
        JsonNode set = gen.SetStaffMeasure(expected, "s2", newId);
        Gen.ApplyReference(expected, set);

        string next = await PatchOkAsync(client, id, etag, delete, insert, set);

        (JsonNode stored, string current) = await GetAsync(client, id);
        Assert.Equal(next, current);
        Assert.Equal("\"2\"", current);
        Assert.True(JsonNode.DeepEquals(expected, stored));
    }

    [Fact]
    public async Task Setting_the_metadata_updates_the_title_column_and_trims_it_like_a_full_save()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);

        using HttpResponseMessage response = await PatchAsync(
            client, id, etag, Parse("""{"op":"setMeta","meta":{"title":"  New title  ","composer":"Me","tempoBpm":90}}"""));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        JsonNode saved = (await JsonNode.ParseAsync(await response.Content.ReadAsStreamAsync(Ct), cancellationToken: Ct))!;
        Assert.Equal("New title", saved["title"]!.GetValue<string>());
        Assert.Equal(2, saved["version"]!.GetValue<int>());
        Assert.Equal(1, saved["schemaVersion"]!.GetValue<int>());

        (JsonNode stored, _) = await GetAsync(client, id);
        Assert.Equal("New title", stored["meta"]!["title"]!.GetValue<string>());
        Assert.Equal("Me", stored["meta"]!["composer"]!.GetValue<string>());
        using HttpResponseMessage list = await client.GetAsync("/api/scores?q=New%20title", Ct);
        JsonNode page = (await JsonNode.ParseAsync(await list.Content.ReadAsStreamAsync(Ct), cancellationToken: Ct))!;
        Assert.Equal(1, page["total"]!.GetValue<int>());
    }

    [Fact]
    public async Task A_patch_that_does_not_change_the_title_keeps_it()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);

        using HttpResponseMessage response = await PatchAsync(
            client, id, etag, Parse("""{"op":"setMeasureInfo","measureId":"m2","value":{"id":"m2","keyFifths":2}}"""));

        JsonNode saved = (await JsonNode.ParseAsync(await response.Content.ReadAsStreamAsync(Ct), cancellationToken: Ct))!;
        Assert.Equal("Small score", saved["title"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_patch_works_with_a_gzip_body()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);

        using HttpResponseMessage response = await client.SendAsync(
            PatchRequest(id, etag, Ops(Parse("""{"op":"setMeasureInfo","measureId":"m3","value":{"id":"m3","tempoBpm":77}}""")), gzip: true), Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        (JsonNode stored, _) = await GetAsync(client, id);
        Assert.Equal(77, stored["measures"]![2]!["tempoBpm"]!.GetValue<int>());
    }

    [Fact]
    public async Task The_same_replacement_applied_twice_gives_the_same_document()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);
        JsonNode op = Parse("""{"op":"setMeasureInfo","measureId":"m2","value":{"id":"m2","keyFifths":-3}}""");

        etag = await PatchOkAsync(client, id, etag, op.DeepClone());
        (JsonNode first, _) = await GetAsync(client, id);
        etag = await PatchOkAsync(client, id, etag, op.DeepClone());
        (JsonNode second, string version) = await GetAsync(client, id);

        Assert.True(JsonNode.DeepEquals(first, second));
        Assert.Equal("\"3\"", version);
    }

    // ---- rejected patches ------------------------------------------------------------------------------------

    public static TheoryData<string> InvalidPatches() =>
    [
        // not a patch
        """[]""",
        """{}""",
        """{"ops":[]}""",
        """{"ops":{}}""",
        """{"ops":[1]}""",
        """{"ops":[{}]}""",
        """{"ops":[{"op":"drop"}]}""",
        """{"ops":[{"op":"setSlurs","slurs":[]}],"extra":1}""",
        """{"ops":[{"op":"setSlurs","slurs":[]}],"ops":[{"op":"setSlurs","slurs":[]}]}""",
        // unknown ids
        """{"ops":[{"op":"setMeasureInfo","measureId":"nope","value":{"id":"nope"}}]}""",
        """{"ops":[{"op":"setStaffMeasure","staffId":"s1","measureId":"nope","value":{"voices":[]}}]}""",
        """{"ops":[{"op":"setStaffMeasure","staffId":"nope","measureId":"m1","value":{"voices":[{"id":"v","events":[{"kind":"rest","id":"r","duration":{"base":"whole","dots":0}}],"tuplets":[]}]}}]}""",
        """{"ops":[{"op":"deleteMeasure","measureId":"nope"}]}""",
        """{"ops":[{"op":"deletePart","partId":"nope"}]}""",
        // the value must carry the id of its target
        """{"ops":[{"op":"setMeasureInfo","measureId":"m2","value":{"id":"m3"}}]}""",
        // schema violations inside a fragment
        """{"ops":[{"op":"setMeasureInfo","measureId":"m2","value":{"id":"m2","keyFifths":9}}]}""",
        """{"ops":[{"op":"setMeasureInfo","measureId":"m2","value":{"id":"m2","extra":1}}]}""",
        """{"ops":[{"op":"setMeasureInfo","measureId":"bad id","value":{"id":"bad id"}}]}""",
        """{"ops":[{"op":"setMeasureInfo","measureId":"m2","value":{"id":"m2","length":121}}]}""",
        """{"ops":[{"op":"setStaffMeasure","staffId":"s1","measureId":"m1","value":{"voices":[]}}]}""",
        """{"ops":[{"op":"setStaffMeasure","staffId":"s1","measureId":"m1","value":{"clef":"banjo","voices":[{"id":"v","events":[{"kind":"rest","id":"r","duration":{"base":"whole","dots":0}}],"tuplets":[]}]}}]}""",
        """{"ops":[{"op":"setStaffMeasure","staffId":"s1","measureId":"m1","value":{"voices":[{"id":"v","events":[{"kind":"note","id":"n","duration":{"base":"whole","dots":0},"pitches":[]}],"tuplets":[]}]}}]}""",
        """{"ops":[{"op":"setStaffMeasure","staffId":"s1","measureId":"m1","value":{"voices":[{"id":"v\n","events":[{"kind":"rest","id":"r","duration":{"base":"whole","dots":0}}],"tuplets":[]}]}}]}""",
        """{"ops":[{"op":"setMeta","meta":{"title":"","composer":"","tempoBpm":100}}]}""",
        """{"ops":[{"op":"setMeta","meta":{"title":"a\u0007b","composer":"","tempoBpm":100}}]}""",
        """{"ops":[{"op":"setMeta","meta":{"title":"x","composer":"","tempoBpm":999}}]}""",
        """{"ops":[{"op":"setSlurs","slurs":[{"id":"a","startEventId":"b"}]}]}""",
        """{"ops":[{"op":"setSlurs","slurs":"none"}]}""",
        // structure that the stored document does not allow
        """{"ops":[{"op":"insertMeasure","index":99,"info":{"id":"new"},"staffMeasures":[]}]}""",
        """{"ops":[{"op":"insertMeasure","index":0,"info":{"id":"m1"},"staffMeasures":[]}]}""",
        """{"ops":[{"op":"insertMeasure","index":-1,"info":{"id":"new"},"staffMeasures":[]}]}""",
        """{"ops":[{"op":"insertMeasure","index":0,"info":{"id":"new"},"staffMeasures":[{"staffId":"s1","value":{"voices":[{"id":"v","events":[{"kind":"rest","id":"r","duration":{"base":"whole","dots":0}}],"tuplets":[]}]}}]}]}""",
        """{"ops":[{"op":"deleteMeasure","measureId":"m1"},{"op":"deleteMeasure","measureId":"m2"},{"op":"deleteMeasure","measureId":"m3"},{"op":"deleteMeasure","measureId":"m4"}]}""",
        """{"ops":[{"op":"deletePart","partId":"p1"},{"op":"deletePart","partId":"p2"},{"op":"deletePart","partId":"p3"}]}""",
        """{"ops":[{"op":"insertPart","index":0,"value":{"id":"p1","name":"x","instrument":"piano","transposition":0,"staves":[{"id":"zz","clef":"treble","type":"standard","measures":[{"voices":[{"id":"v","events":[{"kind":"rest","id":"r","duration":{"base":"whole","dots":0}}],"tuplets":[]}]}]}]}}]}""",
        """{"ops":[{"op":"insertPart","index":0,"value":{"id":"pz","name":"x","instrument":"piano","transposition":0,"staves":[{"id":"s1","clef":"treble","type":"standard","measures":[{"voices":[{"id":"v","events":[{"kind":"rest","id":"r","duration":{"base":"whole","dots":0}}],"tuplets":[]}]}]}]}}]}""",
        """{"ops":[{"op":"replacePart","partId":"p1","value":{"id":"p1","name":"x","instrument":"piano","transposition":0,"staves":[{"id":"s3","clef":"treble","type":"standard","measures":[{"voices":[{"id":"v","events":[{"kind":"rest","id":"r","duration":{"base":"whole","dots":0}}],"tuplets":[]}]}]}]}}]}""",
    ];

    [Theory]
    [MemberData(nameof(InvalidPatches))]
    public async Task An_invalid_patch_is_refused_and_changes_nothing(string body)
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);
        (JsonNode before, _) = await GetAsync(client, id);

        using HttpResponseMessage response = await client.SendAsync(PatchRequest(id, etag, body), Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        (JsonNode after, string current) = await GetAsync(client, id);
        Assert.Equal(etag, current);
        Assert.True(JsonNode.DeepEquals(before, after));
    }

    [Fact]
    public async Task A_failing_operation_rolls_back_the_whole_batch()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);
        (JsonNode before, _) = await GetAsync(client, id);

        using HttpResponseMessage response = await PatchAsync(
            client,
            id,
            etag,
            Parse("""{"op":"setMeasureInfo","measureId":"m2","value":{"id":"m2","keyFifths":4}}"""),
            Parse("""{"op":"deleteMeasure","measureId":"nope"}"""));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        (JsonNode after, string current) = await GetAsync(client, id);
        Assert.Equal(etag, current);
        Assert.True(JsonNode.DeepEquals(before, after));
    }

    [Fact]
    public async Task Too_many_operations_are_refused()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);
        JsonNode op = Parse("""{"op":"setSlurs","slurs":[]}""");

        using HttpResponseMessage tooMany = await PatchAsync(client, id, etag, Enumerable.Range(0, ScoreLimits.MaxPatchOps + 1).Select(_ => op.DeepClone()).ToArray());
        using HttpResponseMessage enough = await PatchAsync(client, id, etag, Enumerable.Range(0, ScoreLimits.MaxPatchOps).Select(_ => op.DeepClone()).ToArray());

        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
        Assert.Equal(HttpStatusCode.OK, enough.StatusCode);
    }

    [Fact]
    public async Task A_patch_that_expands_to_too_many_edits_is_refused()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);
        JsonNode expected = Parse(Small);
        Gen gen = new(3);
        // 4 staves: each insertMeasure is 5 edits; 14 of them exceed 64.
        List<JsonNode> ops = [];
        for (int i = 0; i < 14; i++)
        {
            JsonNode op = gen.InsertMeasure(expected, 0);
            ops.Add(op);
        }

        using HttpResponseMessage response = await PatchAsync(client, id, etag, [.. ops]);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("edits", await response.Content.ReadAsStringAsync(Ct), StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_oversized_patch_body_is_413_and_a_decompression_bomb_too()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);
        string padding = new('x', ScoreLimits.MaxPatchBytes + 10);
        string huge = $$$"""{"ops":[{"op":"setMeta","meta":{"title":"t","composer":"{{{padding}}}","tempoBpm":100}}]}""";

        using HttpResponseMessage plain = await client.SendAsync(PatchRequest(id, etag, huge), Ct);
        using HttpResponseMessage bomb = await client.SendAsync(PatchRequest(id, etag, huge, gzip: true), Ct);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, plain.StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, bomb.StatusCode);
        Assert.Equal(etag, (await GetAsync(client, id)).ETag);
    }

    [Fact]
    public async Task Preconditions_and_media_type_are_checked_first()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);
        string body = Ops(Parse("""{"op":"setSlurs","slurs":[]}"""));

        using HttpResponseMessage missing = await client.SendAsync(PatchRequest(id, null, body), Ct);
        using HttpResponseMessage star = await client.SendAsync(PatchRequest(id, "*", body), Ct);
        using HttpResponseMessage text = await client.SendAsync(PatchRequest(id, "abc", body), Ct);
        HttpRequestMessage wrongType = PatchRequest(id, etag, body);
        wrongType.Content = new StringContent(body, Encoding.UTF8, "text/plain");
        using HttpResponseMessage unsupported = await client.SendAsync(wrongType, Ct);
        HttpRequestMessage wrongEncoding = PatchRequest(id, etag, body);
        wrongEncoding.Content!.Headers.ContentEncoding.Add("compress");
        using HttpResponseMessage encoding = await client.SendAsync(wrongEncoding, Ct);
        HttpRequestMessage corrupt = PatchRequest(id, etag, body);
        corrupt.Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body));
        corrupt.Content.Headers.ContentType = new("application/json");
        corrupt.Content.Headers.ContentEncoding.Add("gzip");
        using HttpResponseMessage corruptResponse = await client.SendAsync(corrupt, Ct);

        Assert.Equal(HttpStatusCode.PreconditionRequired, missing.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, star.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, text.StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, unsupported.StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, encoding.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, corruptResponse.StatusCode);
    }

    [Fact]
    public async Task Malformed_bodies_are_400()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);

        foreach (string body in new[] { "", "{", "not json", "{\"ops\":[{\"op\":\"setSlurs\",\"slurs\":[]}]", "null" })
        {
            using HttpResponseMessage response = await client.SendAsync(PatchRequest(id, etag, body), Ct);
            Assert.True(response.StatusCode == HttpStatusCode.BadRequest, $"'{body}' -> {response.StatusCode}");
        }

        // A byte order mark and invalid UTF-8.
        foreach (byte[] raw in new byte[][] { [0xEF, 0xBB, 0xBF, (byte)0x7B, (byte)0x7D], [(byte)0x7B, 0xFF, (byte)0x7D] })
        {
            HttpRequestMessage request = PatchRequest(id, etag, "{}");
            request.Content = new ByteArrayContent(raw);
            request.Content.Headers.ContentType = new("application/json");
            using HttpResponseMessage response = await client.SendAsync(request, Ct);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        Assert.Equal(etag, (await GetAsync(client, id)).ETag);
    }

    [Fact]
    public async Task Characters_jsonb_cannot_store_are_400()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);

        using HttpResponseMessage response = await PatchAsync(
            client, id, etag, Parse("""{"op":"setMeta","meta":{"title":"ok","composer":"a\u0000b","tempoBpm":100}}"""));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(etag, (await GetAsync(client, id)).ETag);
    }

    [Fact]
    public async Task A_stored_score_with_inconsistent_structure_must_be_saved_in_full_first()
    {
        using HttpClient client = await SignedInAsync();
        // A full save does not check that every staff has one measure per measure: this one has two measures but a
        // staff with a single measure, and a reused measure id.
        JsonNode odd = Parse(Small);
        odd["measures"]!.AsArray().Add(Parse("""{"id":"m4"}"""));
        (Guid id, string etag) = await CreateAsync(client, odd.ToJsonString());

        using HttpResponseMessage response = await PatchAsync(
            client, id, etag, Parse("""{"op":"setMeasureInfo","measureId":"m1","value":{"id":"m1"}}"""));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("full document", await response.Content.ReadAsStringAsync(Ct), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_patch_cannot_grow_the_score_beyond_what_a_full_save_accepts()
    {
        using HttpClient client = await SignedInAsync();
        JsonNode doc = Parse(Big);
        // 2000 measures of the 500 measure fixture: about 3.7 MB, under the 4 MiB limit of a full save.
        JsonArray measures = doc["measures"]!.AsArray();
        for (int i = 501; i <= 2000; i++)
        {
            measures.Add(Parse($$"""{"id":"m{{i}}"}"""));
        }

        foreach (JsonNode? part in doc["parts"]!.AsArray())
        {
            foreach (JsonNode? staff in part!["staves"]!.AsArray())
            {
                JsonArray list = staff!["measures"]!.AsArray();
                for (int i = 500; i < 2000; i++)
                {
                    list.Add(list[i % 500]!.DeepClone());
                }
            }
        }

        string full = doc.ToJsonString();
        Assert.InRange(full.Length, 3_000_000, ScoreLimits.MaxContentBytes);
        (Guid id, string etag) = await CreateAsync(client, full);

        // Four big measures (about 130 KB each) per patch, on measures not yet replaced: the document grows by about
        // 500 KB per patch until the stored size limit stops it.
        JsonObject big = BigStaffMeasure();
        HttpStatusCode last = HttpStatusCode.OK;
        int accepted = 0;
        for (int round = 0; round < 12 && last == HttpStatusCode.OK; round++)
        {
            JsonNode[] ops = [.. Enumerable.Range(0, 4).Select(i =>
            {
                JsonNode op = Parse($$$"""{"op":"setStaffMeasure","staffId":"s1","measureId":"m{{{round * 4 + i + 1}}}"}""");
                op["value"] = big.DeepClone();
                return op;
            })];
            using HttpResponseMessage response = await PatchAsync(client, id, etag, ops);
            last = response.StatusCode;
            if (last == HttpStatusCode.OK)
            {
                etag = response.Headers.ETag!.Tag;
                accepted++;
            }
        }

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, last);
        Assert.InRange(accepted, 1, 11);
        using HttpResponseMessage stored = await client.GetAsync($"/api/scores/{id}", Ct);
        Assert.InRange((await stored.Content.ReadAsByteArrayAsync(Ct)).Length, 1, ScoreLimits.MaxStoredContentBytes);
        Assert.Equal(etag, stored.Headers.ETag!.Tag);

        // And the measure limit of the schema holds: this score has 2000 measures.
        using HttpResponseMessage one = await PatchAsync(client, id, etag, new Gen(9).InsertMeasure(doc, 0));
        Assert.Equal(HttpStatusCode.BadRequest, one.StatusCode);
    }

    private static JsonObject BigStaffMeasure()
    {
        JsonArray events = [];
        for (int i = 0; i < 512; i++)
        {
            events.Add(Parse($$$"""{"kind":"note","id":"big{{{i}}}","duration":{"base":"32nd","dots":0},"pitches":[{"step":"C","alter":0,"octave":4,"fretting":{"string":1,"fret":3,"manual":true}},{"step":"E","alter":0,"octave":4},{"step":"G","alter":0,"octave":4}]}"""));
        }

        JsonArray voices = [];
        for (int v = 0; v < 1; v++)
        {
            voices.Add(new JsonObject { ["id"] = $"bigv{v}", ["events"] = events.DeepClone(), ["tuplets"] = new JsonArray() });
        }

        return new JsonObject { ["voices"] = voices };
    }

    // ---- access control, antiforgery -------------------------------------------------------------------------

    [Fact]
    public async Task Another_users_score_is_404_whatever_the_patch()
    {
        using HttpClient owner = await SignedInAsync();
        using HttpClient other = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(owner);
        JsonNode valid = Parse("""{"op":"setMeasureInfo","measureId":"m2","value":{"id":"m2","keyFifths":1}}""");
        JsonNode invalid = Parse("""{"op":"deleteMeasure","measureId":"nope"}""");

        using HttpResponseMessage good = await PatchAsync(other, id, etag, valid.DeepClone());
        using HttpResponseMessage bad = await PatchAsync(other, id, etag, invalid.DeepClone());
        using HttpResponseMessage unknown = await PatchAsync(other, Guid.NewGuid(), etag, valid.DeepClone());
        using HttpResponseMessage wrongVersion = await PatchAsync(other, id, "\"99\"", valid.DeepClone());

        foreach (HttpResponseMessage response in new[] { good, bad, unknown, wrongVersion })
        {
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }

        (JsonNode stored, string current) = await GetAsync(owner, id);
        Assert.Equal(etag, current);
        Assert.Null(stored["measures"]![1]!["keyFifths"]);
    }

    [Fact]
    public async Task The_antiforgery_header_is_required()
    {
        using HttpClient noToken = await SignedInAsync(sendToken: false);
        using HttpClient withToken = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(withToken);

        using HttpResponseMessage response = await PatchAsync(noToken, id, etag, Parse("""{"op":"setSlurs","slurs":[]}"""));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("antiforgery", await response.Content.ReadAsStringAsync(Ct), StringComparison.Ordinal);
        Assert.Equal(etag, (await GetAsync(withToken, id)).ETag);
    }

    [Fact]
    public async Task Anonymous_callers_are_refused()
    {
        fixture.Postgres.SkipIfUnavailable();
        using HttpClient anonymous = fixture.App.CreateSecureClient();

        using HttpResponseMessage response = await anonymous.SendAsync(PatchRequest(Guid.NewGuid(), "\"1\"", Ops(Parse("""{"op":"setSlurs","slurs":[]}"""))), Ct);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ---- concurrency -----------------------------------------------------------------------------------------

    [Fact]
    public async Task A_stale_version_is_409_for_a_patch_and_for_a_full_save()
    {
        using HttpClient tabA = await SignedInAsync();
        (Guid id, string v1) = await CreateAsync(tabA);
        string v2 = await PatchOkAsync(tabA, id, v1, Parse("""{"op":"setMeasureInfo","measureId":"m2","value":{"id":"m2","keyFifths":1}}"""));

        using HttpResponseMessage stalePatch = await PatchAsync(tabA, id, v1, Parse("""{"op":"setMeasureInfo","measureId":"m2","value":{"id":"m2","keyFifths":5}}"""));
        HttpRequestMessage put = new(HttpMethod.Put, $"/api/scores/{id}") { Content = Json(Small) };
        put.Headers.TryAddWithoutValidation("If-Match", v1);
        using HttpResponseMessage stalePut = await tabA.SendAsync(put, Ct);

        Assert.Equal(HttpStatusCode.Conflict, stalePatch.StatusCode);
        Assert.Equal("urn:polymnia:problem:version-conflict", (await JsonNode.ParseAsync(await stalePatch.Content.ReadAsStreamAsync(Ct), cancellationToken: Ct))!["type"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.Conflict, stalePut.StatusCode);
        (JsonNode stored, string current) = await GetAsync(tabA, id);
        Assert.Equal(v2, current);
        Assert.Equal(1, stored["measures"]![1]!["keyFifths"]!.GetValue<int>());
    }

    [Fact]
    public async Task A_patch_after_a_full_save_needs_the_new_version()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string v1) = await CreateAsync(client);
        HttpRequestMessage put = new(HttpMethod.Put, $"/api/scores/{id}") { Content = Json(Small) };
        put.Headers.TryAddWithoutValidation("If-Match", v1);
        using HttpResponseMessage saved = await client.SendAsync(put, Ct);
        string v2 = saved.Headers.ETag!.Tag;

        using HttpResponseMessage stale = await PatchAsync(client, id, v1, Parse("""{"op":"setSlurs","slurs":[]}"""));
        using HttpResponseMessage fresh = await PatchAsync(client, id, v2, Parse("""{"op":"setSlurs","slurs":[]}"""));

        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal(HttpStatusCode.OK, fresh.StatusCode);
        Assert.Equal("\"3\"", fresh.Headers.ETag!.Tag);
    }

    [Fact]
    public async Task Concurrent_patches_at_the_same_version_let_exactly_one_win()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);
        // The per-user concurrency limit is 2 writes in flight: use several users' worth of retries instead.
        Task<HttpResponseMessage>[] calls =
        [
            .. Enumerable.Range(0, 2).Select(i => PatchAsync(client, id, etag,
                Parse($$$"""{"op":"setMeasureInfo","measureId":"m2","value":{"id":"m2","keyFifths":{{{i + 1}}}}}"""))),
        ];
        HttpResponseMessage[] responses = await Task.WhenAll(calls);

        int ok = responses.Count(r => r.StatusCode == HttpStatusCode.OK);
        int conflict = responses.Count(r => r.StatusCode == HttpStatusCode.Conflict);
        foreach (HttpResponseMessage response in responses)
        {
            response.Dispose();
        }

        Assert.Equal(1, ok);
        Assert.Equal(1, conflict);
        Assert.Equal("\"2\"", (await GetAsync(client, id)).ETag);
    }

    [Fact]
    public async Task A_patch_and_a_rename_at_the_same_version_conflict()
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string v1) = await CreateAsync(client);
        HttpRequestMessage rename = new(HttpMethod.Patch, $"/api/scores/{id}") { Content = Json("""{"title":"Renamed"}""") };
        rename.Headers.TryAddWithoutValidation("If-Match", v1);
        using HttpResponseMessage renamed = await client.SendAsync(rename, Ct);

        using HttpResponseMessage patch = await PatchAsync(client, id, v1, Parse("""{"op":"setSlurs","slurs":[]}"""));

        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, patch.StatusCode);
    }

    // ---- equivalence with full saves -------------------------------------------------------------------------

    [Theory]
    [InlineData(101)]
    [InlineData(202)]
    [InlineData(303)]
    [InlineData(404)]
    [InlineData(505)]
    [InlineData(606)]
    public async Task Random_edit_sequences_give_the_same_document_through_patches_and_full_saves(int seed)
    {
        using HttpClient client = await SignedInAsync();
        (Guid patched, string patchedTag) = await CreateAsync(client);
        (Guid full, string fullTag) = await CreateAsync(client);
        JsonNode reference = Parse(Small);
        Gen gen = new(seed);
        Random random = new(seed);

        for (int round = 0; round < 25; round++)
        {
            // A batch of 1 to 4 operations, the way an autosave sends them.
            List<JsonNode> batch = [];
            JsonNode scratch = reference.DeepClone();
            int count = random.Next(1, 5);
            for (int i = 0; i < count; i++)
            {
                JsonNode? op = gen.RandomOp(scratch);
                if (op is not null)
                {
                    Gen.ApplyReference(scratch, op);
                    batch.Add(op);
                }
            }

            if (batch.Count == 0)
            {
                continue;
            }

            patchedTag = await PatchOkAsync(client, patched, patchedTag, [.. batch.Select(b => b.DeepClone())]);
            reference = scratch;

            // The full save of the same document (this is what the editor sends when it does not use a patch)...
            HttpRequestMessage put = new(HttpMethod.Put, $"/api/scores/{full}") { Content = Json(reference.ToJsonString()) };
            put.Headers.TryAddWithoutValidation("If-Match", fullTag);
            using HttpResponseMessage saved = await client.SendAsync(put, Ct);
            Assert.True(saved.StatusCode == HttpStatusCode.OK, $"seed {seed} round {round}: the full validator refused the reference document: {await saved.Content.ReadAsStringAsync(Ct)}");
            fullTag = saved.Headers.ETag!.Tag;

            // ... gives exactly the document the patches built.
            (JsonNode viaPatch, _) = await GetAsync(client, patched);
            (JsonNode viaPut, _) = await GetAsync(client, full);
            Assert.True(JsonNode.DeepEquals(viaPut, viaPatch), $"seed {seed} round {round}: documents differ after {string.Join(", ", batch.Select(b => b["op"]!.GetValue<string>()))}");
            Assert.True(JsonNode.DeepEquals(reference, viaPatch), $"seed {seed} round {round}: the stored document differs from the reference model");
        }
    }

    [Theory]
    [InlineData(11)]
    [InlineData(22)]
    [InlineData(33)]
    public async Task Random_corrupted_patches_are_refused_and_never_change_the_document(int seed)
    {
        using HttpClient client = await SignedInAsync();
        (Guid id, string etag) = await CreateAsync(client);
        JsonNode reference = Parse(Small);
        Gen gen = new(seed);
        Random random = new(seed);
        int refused = 0;

        for (int round = 0; round < 40; round++)
        {
            JsonNode? op = gen.RandomOp(reference);
            if (op is null)
            {
                continue;
            }

            JsonNode corrupted = Corrupt(op.DeepClone(), random);
            using HttpResponseMessage response = await PatchAsync(client, id, etag, corrupted);

            // A corruption may land on something the schema allows (a different tempo, a renamed id of an unused
            // value...): then the patch is valid, and the reference follows. Otherwise it is refused and nothing moves.
            if (response.StatusCode == HttpStatusCode.OK)
            {
                etag = response.Headers.ETag!.Tag;
                Gen.ApplyReference(reference, corrupted);
                (JsonNode stored, _) = await GetAsync(client, id);
                Assert.True(JsonNode.DeepEquals(reference, stored), $"seed {seed} round {round}: accepted patch differs from the reference model");
            }
            else
            {
                Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
                refused++;
                (JsonNode stored, string current) = await GetAsync(client, id);
                Assert.Equal(etag, current);
                Assert.True(JsonNode.DeepEquals(reference, stored));
            }
        }

        Assert.True(refused > 5, "the corruptions should be refused most of the time");
    }

    // Breaks one thing: a wrong type, an unknown property, an out of range number, a bad id or a missing member.
    private static JsonNode Corrupt(JsonNode op, Random random)
    {
        List<JsonNode> candidates = [];
        Collect(op, candidates);
        JsonObject target = (JsonObject)candidates[random.Next(candidates.Count)];
        string[] keys = [.. target.Select(p => p.Key)];
        string key = keys[random.Next(keys.Length)];
        switch (random.Next(5))
        {
            case 0:
                target[key] = "bad id!";
                break;
            case 1:
                target["unexpected"] = 1;
                break;
            case 2:
                target[key] = 99_999_999;
                break;
            case 3:
                target.Remove(key);
                break;
            default:
                target[key] = new JsonArray();
                break;
        }

        return op;
    }

    private static void Collect(JsonNode node, List<JsonNode> objects)
    {
        switch (node)
        {
            case JsonObject o:
                objects.Add(o);
                foreach (KeyValuePair<string, JsonNode?> p in o)
                {
                    if (p.Value is not null)
                    {
                        Collect(p.Value, objects);
                    }
                }

                break;
            case JsonArray a:
                foreach (JsonNode? item in a)
                {
                    if (item is not null)
                    {
                        Collect(item, objects);
                    }
                }

                break;
        }
    }

    // ---- generator and reference model ---------------------------------------------------------------------

    /// <summary>
    /// Builds random but schema-valid operations from the current reference document, and applies operations to a
    /// reference document with plain <see cref="JsonArray"/> operations (independent of the SQL implementation).
    /// </summary>
    private sealed class Gen(int seed)
    {
        private readonly Random _random = new(seed);
        private int _next = 1000;

        private string NewId(string prefix) => $"{prefix}{_next++}";

        public JsonNode SetMeta(JsonNode doc) =>
            Parse($$$"""{"op":"setMeta","meta":{"title":"Title {{{_random.Next(1000)}}}","composer":"C{{{_random.Next(10)}}}","tempoBpm":{{{_random.Next(20, 400)}}}}}""");

        public JsonObject SetMeasureInfo(JsonNode doc, string measureId)
        {
            JsonObject info = new() { ["id"] = measureId };
            if (_random.Next(2) == 0)
            {
                info["keyFifths"] = _random.Next(-7, 8);
            }

            if (_random.Next(2) == 0)
            {
                info["tempoBpm"] = _random.Next(20, 400);
            }

            if (_random.Next(3) == 0)
            {
                info["time"] = new JsonObject { ["beats"] = _random.Next(1, 33), ["beatType"] = new[] { 1, 2, 4, 8, 16, 32 }[_random.Next(6)] };
            }

            if (_random.Next(3) == 0)
            {
                info["length"] = 120 * _random.Next(1, 1025);
            }

            return new JsonObject { ["op"] = "setMeasureInfo", ["measureId"] = measureId, ["value"] = info };
        }

        public JsonObject SetStaffMeasure(JsonNode doc, string staffId, string measureId) =>
            new JsonObject { ["op"] = "setStaffMeasure", ["staffId"] = staffId, ["measureId"] = measureId, ["value"] = StaffMeasure() };

        public JsonObject InsertMeasure(JsonNode doc, int index)
        {
            JsonArray staffMeasures = [];
            foreach (string staffId in StaffIds(doc))
            {
                staffMeasures.Add(new JsonObject { ["staffId"] = staffId, ["value"] = StaffMeasure() });
            }

            return new JsonObject
            {
                ["op"] = "insertMeasure",
                ["index"] = Math.Min(index, doc["measures"]!.AsArray().Count),
                ["info"] = new JsonObject { ["id"] = NewId("nm") },
                ["staffMeasures"] = staffMeasures,
            };
        }

        public static JsonObject DeleteMeasure(string measureId) => new JsonObject { ["op"] = "deleteMeasure", ["measureId"] = measureId };

        public JsonObject SetSlurs()
        {
            JsonArray slurs = [];
            for (int i = _random.Next(0, 4); i > 0; i--)
            {
                slurs.Add(new JsonObject { ["id"] = NewId("sl"), ["startEventId"] = NewId("ev"), ["endEventId"] = NewId("ev") });
            }

            return new JsonObject { ["op"] = "setSlurs", ["slurs"] = slurs };
        }

        public JsonObject ReplacePart(JsonNode doc, string partId)
        {
            JsonObject part = (JsonObject)doc["parts"]!.AsArray().Single(p => p!["id"]!.GetValue<string>() == partId)!.DeepClone();
            part["name"] = "Renamed " + _random.Next(100);
            part["transposition"] = _random.Next(-12, 13);
            if (_random.Next(2) == 0)
            {
                part["capo"] = _random.Next(0, 10);
            }

            JsonArray staves = part["staves"]!.AsArray();
            JsonObject first = (JsonObject)staves[0]!;
            first["clef"] = "bass";
            int measureCount = first["measures"]!.AsArray().Count;
            JsonArray measures = first["measures"]!.AsArray();
            measures[_random.Next(measureCount)] = StaffMeasure();
            return new JsonObject { ["op"] = "replacePart", ["partId"] = partId, ["value"] = part };
        }

        public JsonObject InsertPart(JsonNode doc, int index)
        {
            int measureCount = doc["measures"]!.AsArray().Count;
            JsonArray staves = [];
            for (int s = _random.Next(1, 3); s > 0; s--)
            {
                JsonArray measures = [];
                for (int m = 0; m < measureCount; m++)
                {
                    measures.Add(StaffMeasure());
                }

                staves.Add(new JsonObject { ["id"] = NewId("ns"), ["clef"] = "treble", ["type"] = "standard", ["measures"] = measures });
            }

            JsonObject part = new()
            {
                ["id"] = NewId("np"),
                ["name"] = "New",
                ["instrument"] = "flute",
                ["transposition"] = 0,
                ["staves"] = staves,
            };
            return new JsonObject { ["op"] = "insertPart", ["index"] = Math.Min(index, doc["parts"]!.AsArray().Count), ["value"] = part };
        }

        public static JsonObject DeletePart(string partId) => new JsonObject { ["op"] = "deletePart", ["partId"] = partId };

        public JsonObject StaffMeasure()
        {
            JsonArray voices = [];
            for (int v = _random.Next(1, 3); v > 0; v--)
            {
                JsonArray events = [];
                for (int e = _random.Next(1, 7); e > 0; e--)
                {
                    events.Add(_random.Next(3) == 0
                        ? Parse($$$"""{"kind":"rest","id":"{{{NewId("r")}}}","duration":{"base":"quarter","dots":{{{_random.Next(3)}}}}}""")
                        : Parse($$$"""{"kind":"note","id":"{{{NewId("n")}}}","duration":{"base":"eighth","dots":0},"pitches":[{"step":"{{{"CDEFGAB"[_random.Next(7)]}}}","alter":{{{_random.Next(-2, 3)}}},"octave":{{{_random.Next(-1, 10)}}}}]}"""));
                }

                voices.Add(new JsonObject { ["id"] = NewId("v"), ["events"] = events, ["tuplets"] = new JsonArray() });
            }

            JsonObject measure = new() { ["voices"] = voices };
            if (_random.Next(4) == 0)
            {
                measure["clef"] = "alto";
            }

            return measure;
        }

        /// <summary>A random valid operation for the document, or <c>null</c> when the dice picked something impossible.</summary>
        public JsonNode? RandomOp(JsonNode doc)
        {
            JsonArray measures = doc["measures"]!.AsArray();
            JsonArray parts = doc["parts"]!.AsArray();
            string measureId = measures[_random.Next(measures.Count)]!["id"]!.GetValue<string>();
            string[] staffIds = [.. StaffIds(doc)];
            string partId = parts[_random.Next(parts.Count)]!["id"]!.GetValue<string>();
            return _random.Next(14) switch
            {
                0 => SetMeta(doc),
                1 or 2 => SetMeasureInfo(doc, measureId),
                3 or 4 or 5 or 6 => SetStaffMeasure(doc, staffIds[_random.Next(staffIds.Length)], measureId),
                7 or 8 => InsertMeasure(doc, _random.Next(measures.Count + 1)),
                9 => measures.Count > 1 ? Gen.DeleteMeasure(measureId) : null,
                10 => SetSlurs(),
                11 => ReplacePart(doc, partId),
                12 => parts.Count < 6 ? InsertPart(doc, _random.Next(parts.Count + 1)) : null,
                _ => parts.Count > 1 ? Gen.DeletePart(partId) : null,
            };
        }

        private static IEnumerable<string> StaffIds(JsonNode doc) =>
            doc["parts"]!.AsArray().SelectMany(p => p!["staves"]!.AsArray()).Select(s => s!["id"]!.GetValue<string>());

        public static void ApplyReference(JsonNode doc, JsonNode op)
        {
            JsonArray measures = doc["measures"]!.AsArray();
            JsonArray parts = doc["parts"]!.AsArray();
            int MeasureIndex(string id) => measures.ToList().FindIndex(m => m!["id"]!.GetValue<string>() == id);
            int PartIndex(string id) => parts.ToList().FindIndex(p => p!["id"]!.GetValue<string>() == id);
            JsonArray StaffMeasures(string staffId) =>
                parts.SelectMany(p => p!["staves"]!.AsArray()).Single(s => s!["id"]!.GetValue<string>() == staffId)!["measures"]!.AsArray();

            switch (op["op"]!.GetValue<string>())
            {
                case "setMeta":
                    JsonObject meta = (JsonObject)op["meta"]!.DeepClone();
                    meta["title"] = meta["title"]!.GetValue<string>().Trim();
                    doc["meta"] = meta;
                    break;
                case "setMeasureInfo":
                    measures[MeasureIndex(op["measureId"]!.GetValue<string>())] = op["value"]!.DeepClone();
                    break;
                case "setStaffMeasure":
                    StaffMeasures(op["staffId"]!.GetValue<string>())[MeasureIndex(op["measureId"]!.GetValue<string>())] = op["value"]!.DeepClone();
                    break;
                case "insertMeasure":
                    int index = op["index"]!.GetValue<int>();
                    measures.Insert(index, op["info"]!.DeepClone());
                    foreach (JsonNode? entry in op["staffMeasures"]!.AsArray())
                    {
                        StaffMeasures(entry!["staffId"]!.GetValue<string>()).Insert(index, entry["value"]!.DeepClone());
                    }

                    break;
                case "deleteMeasure":
                    int at = MeasureIndex(op["measureId"]!.GetValue<string>());
                    measures.RemoveAt(at);
                    foreach (JsonNode? part in parts)
                    {
                        foreach (JsonNode? staff in part!["staves"]!.AsArray())
                        {
                            staff!["measures"]!.AsArray().RemoveAt(at);
                        }
                    }

                    break;
                case "replacePart":
                    parts[PartIndex(op["partId"]!.GetValue<string>())] = op["value"]!.DeepClone();
                    break;
                case "insertPart":
                    parts.Insert(op["index"]!.GetValue<int>(), op["value"]!.DeepClone());
                    break;
                case "deletePart":
                    parts.RemoveAt(PartIndex(op["partId"]!.GetValue<string>()));
                    break;
                case "setSlurs":
                    doc["slurs"] = op["slurs"]!.DeepClone();
                    break;
                default:
                    throw new InvalidOperationException("unknown op");
            }
        }
    }
}
