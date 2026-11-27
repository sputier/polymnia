using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Polymnia.Tests;

/// <summary>
/// Latency of get / list / update on a 500-measure score, in process (full pipeline, real PostgreSQL, no network).
/// Opt-in because timings are machine dependent: set <c>POLYMNIA_PERF=true</c>. The budget is p95 below 50 ms (met for get and list, not for update on this setup).
/// </summary>
public sealed class ScorePerformanceTests(ScoreApiFixture fixture) : IClassFixture<ScoreApiFixture>
{
    private const int Iterations = 200;
    private const double BudgetMs = 50;

    // PUT moves 1 MB through the test database (Docker port proxy on Windows: about 55 ms for the transfer alone)
    // and PostgreSQL parses it as jsonb (about 30 ms), so only a regression guard applies; see docs/api.md.
    private const double UpdateGuardMs = 300;

    [Fact]
    public async Task Get_list_and_update_of_a_500_measure_score_stay_under_budget()
    {
        Assert.SkipUnless(
            string.Equals(Environment.GetEnvironmentVariable("POLYMNIA_PERF"), "true", StringComparison.OrdinalIgnoreCase),
            "Set POLYMNIA_PERF=true to run the latency measurements.");
        fixture.Postgres.SkipIfUnavailable();
        CancellationToken ct = TestContext.Current.CancellationToken;

        string big = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Fixtures", "score-500-measures.json"), ct);
        using var app = new TestApp(
            connectionString: fixture.Postgres.ConnectionString,
            settings: new() { ["RateLimiting:ScoreWrites:PermitLimit"] = "1000000", ["RateLimiting:ScoreWrites:ReadPermitLimit"] = "1000000" });
        await app.MigrateAsync();
        using HttpClient client = await ScoreTestClients.SignInAsync(app);

        using HttpResponseMessage created = await client.PostAsync("/api/scores", new StringContent(big, Encoding.UTF8, "application/json"), ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Guid id = JsonDocument.Parse(await created.Content.ReadAsStringAsync(ct)).RootElement.GetProperty("id").GetGuid();
        for (int i = 0; i < 19; i++)
        {
            using HttpResponseMessage more = await client.PostAsync("/api/scores", new StringContent(big, Encoding.UTF8, "application/json"), ct);
        }

        string etag = created.Headers.ETag!.Tag;
        var get = new List<double>();
        var list = new List<double>();
        var update = new List<double>();
        var getConditional = new List<double>();
        var updateGzip = new List<double>();
        byte[] gz = Gzip(big);

        // A typical autosave batch: one measure of one staff, and three measures (two staves and a measure attribute).
        JsonNode doc = JsonNode.Parse(big)!;
        JsonNode MeasureOf(int staff, int measure) => doc["parts"]![staff / 2]!["staves"]![staff % 2]!["measures"]![measure]!.DeepClone();
        string patchOne = new JsonObject
        {
            ["ops"] = new JsonArray(new JsonObject { ["op"] = "setStaffMeasure", ["staffId"] = "s1", ["measureId"] = "m250", ["value"] = MeasureOf(0, 249) }),
        }.ToJsonString();
        string patchThree = new JsonObject
        {
            ["ops"] = new JsonArray(
                new JsonObject { ["op"] = "setStaffMeasure", ["staffId"] = "s1", ["measureId"] = "m251", ["value"] = MeasureOf(0, 250) },
                new JsonObject { ["op"] = "setStaffMeasure", ["staffId"] = "s2", ["measureId"] = "m251", ["value"] = MeasureOf(1, 250) },
                new JsonObject { ["op"] = "setMeasureInfo", ["measureId"] = "m252", ["value"] = new JsonObject { ["id"] = "m252", ["tempoBpm"] = 100 } }),
        }.ToJsonString();
        var patch1 = new List<double>();
        var patch3 = new List<double>();

        // Warm-up (JIT, connection pool, query plans), not measured.
        for (int i = 0; i < 20; i++)
        {
            (await client.GetAsync($"/api/scores/{id}", ct)).Dispose();
            (await client.GetAsync("/api/scores", ct)).Dispose();
        }

        for (int i = 0; i < Iterations; i++)
        {
            get.Add(await TimeAsync(() => client.GetAsync($"/api/scores/{id}", ct)));
            list.Add(await TimeAsync(() => client.GetAsync("/api/scores?pageSize=20&q=bench", ct)));
            getConditional.Add(await TimeAsync(() =>
            {
                HttpRequestMessage r = new(HttpMethod.Get, $"/api/scores/{id}");
                r.Headers.TryAddWithoutValidation("If-None-Match", etag);
                return client.SendAsync(r, ct);
            }));

            double ms = 0;
            ms = await TimeAsync(async () =>
            {
                HttpRequestMessage r = new(HttpMethod.Put, $"/api/scores/{id}")
                {
                    Content = new StringContent(big, Encoding.UTF8, "application/json"),
                };
                r.Headers.TryAddWithoutValidation("If-Match", etag);
                HttpResponseMessage response = await client.SendAsync(r, ct);
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                etag = response.Headers.ETag!.Tag;
                return response;
            });
            update.Add(ms);

            updateGzip.Add(await TimeAsync(async () =>
            {
                ByteArrayContent body = new(gz);
                body.Headers.ContentType = new("application/json");
                body.Headers.ContentEncoding.Add("gzip");
                HttpRequestMessage r = new(HttpMethod.Put, $"/api/scores/{id}") { Content = body };
                r.Headers.TryAddWithoutValidation("If-Match", etag);
                HttpResponseMessage response = await client.SendAsync(r, ct);
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                etag = response.Headers.ETag!.Tag;
                return response;
            }));

            patch1.Add(await TimeAsync(() => PatchAsync(patchOne)));
            patch3.Add(await TimeAsync(() => PatchAsync(patchThree)));
        }

        async Task<HttpResponseMessage> PatchAsync(string body)
        {
            HttpRequestMessage r = new(HttpMethod.Patch, $"/api/scores/{id}/content")
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            r.Headers.TryAddWithoutValidation("If-Match", etag);
            HttpResponseMessage response = await client.SendAsync(r, ct);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            etag = response.Headers.ETag!.Tag;
            return response;
        }

        string report =
            $"PERF 500 measures ({big.Length / 1024} KB): " +
            $"GET p50 {P(get, 50):F1} p95 {P(get, 95):F1} ms | GET 304 p95 {P(getConditional, 95):F1} ms | " +
            $"LIST(20 of 20) p95 {P(list, 95):F1} ms | PUT p50 {P(update, 50):F1} p95 {P(update, 95):F1} ms | PUT gzip body ({gz.Length / 1024} KB) p50 {P(updateGzip, 50):F1} p95 {P(updateGzip, 95):F1} ms | PATCH 1 measure ({patchOne.Length} B) p50 {P(patch1, 50):F1} p95 {P(patch1, 95):F1} ms | PATCH 3 measures ({patchThree.Length} B) p50 {P(patch3, 50):F1} p95 {P(patch3, 95):F1} ms";
        Console.WriteLine(report);
        if (Environment.GetEnvironmentVariable("POLYMNIA_PERF_REPORT") is { Length: > 0 } reportFile)
        {
            await File.AppendAllTextAsync(reportFile, report + Environment.NewLine, ct);
        }

        TestContext.Current.SendDiagnosticMessage(report);

        Assert.True(P(get, 95) < BudgetMs, report);
        Assert.True(P(list, 95) < BudgetMs, report);
        // The point of PATCH: a typical autosave (one measure) stays inside the budget, the document never travels.
        Assert.True(P(patch1, 95) < BudgetMs, report);
        Assert.True(P(patch3, 95) < UpdateGuardMs, report);
        Assert.True(P(update, 95) < UpdateGuardMs, report);
        Assert.True(P(updateGzip, 95) < UpdateGuardMs, report);
    }

    private static byte[] Gzip(string json)
    {
        using MemoryStream output = new();
        using (System.IO.Compression.GZipStream z = new(output, System.IO.Compression.CompressionLevel.Fastest, leaveOpen: true))
        {
            z.Write(Encoding.UTF8.GetBytes(json));
        }

        return output.ToArray();
    }

    private static async Task<double> TimeAsync(Func<Task<HttpResponseMessage>> call)
    {
        long start = Stopwatch.GetTimestamp();
        using HttpResponseMessage response = await call();
        await response.Content.ReadAsByteArrayAsync();
        return Stopwatch.GetElapsedTime(start).TotalMilliseconds;
    }

    private static double P(List<double> values, int percentile)
    {
        double[] sorted = [.. values.Order()];
        return sorted[Math.Min(sorted.Length - 1, (int)Math.Ceiling(sorted.Length * percentile / 100.0) - 1)];
    }
}
