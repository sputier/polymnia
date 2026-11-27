using System.Net;
using System.Text;

namespace Polymnia.Tests;

/// <summary>No spelling of an API path may slip past the antiforgery check or reach a handler without it.</summary>
public sealed class SecurityReviewPathTests(ScoreApiFixture fixture) : IClassFixture<ScoreApiFixture>
{
    [Theory]
    [InlineData("//api/scores")]
    [InlineData("/api//scores")]
    [InlineData("/API/scores")]
    [InlineData("/api/scores/")]
    [InlineData("/api/%73cores")]
    [InlineData("/api/scores;x=1")]
    public async Task No_spelling_of_the_path_skips_the_antiforgery_check(string path)
    {
        fixture.Postgres.SkipIfUnavailable();
        using HttpClient client = await ScoreTestClients.SignInAsync(fixture.App, sendToken: false);
        string small = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "score-small.json"));

        using HttpResponseMessage response = await client.PostAsync(
            path, new StringContent(small, Encoding.UTF8, "application/json"), TestContext.Current.CancellationToken);

        Assert.NotEqual(HttpStatusCode.Created, response.StatusCode);
        Assert.NotEqual(HttpStatusCode.OK, response.StatusCode);
    }
}
