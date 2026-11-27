using System.Globalization;
using System.Net.Mime;
using Microsoft.AspNetCore.Mvc;
using Polymnia.Core.Scores;
using Polymnia.Infrastructure.Scores;

namespace Polymnia.Api.Scores;

/// <summary>
/// <c>/api/scores</c>. Every endpoint requires a signed-in user and only ever touches that user's scores:
/// a score owned by someone else answers 404, exactly like a score that does not exist.
/// Writes to an existing score require <c>If-Match</c> (the version from the last <c>ETag</c>).
/// </summary>
internal static class ScoreEndpoints
{
    private static readonly HashSet<string> AllowedEncodings = new(StringComparer.OrdinalIgnoreCase) { "gzip", "br", "deflate", "identity" };
    private const string ProblemJson = "application/problem+json";
    private const string QuotaProblemType = "urn:polymnia:problem:score-limit";
    private const string ConflictProblemType = "urn:polymnia:problem:version-conflict";

    public static IEndpointRouteBuilder MapScoreEndpoints(this IEndpointRouteBuilder app)
    {
        RouteGroupBuilder group = app.MapGroup("/api/scores").RequireAuthorization();

        group.MapGet("/", List)
            .WithName("ListScores")
            .Produces<ScorePage>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .AddEndpointFilter<ScoreRateLimitFilter.Reads>();

        group.MapGet("/{id:guid}", Get)
            .WithName("GetScore")
            .Produces(StatusCodes.Status200OK, contentType: MediaTypeNames.Application.Json)
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .AddEndpointFilter<ScoreRateLimitFilter.Reads>();

        group.MapPost("/", Create)
            .WithName("CreateScore")
            .Produces<ScoreSummary>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge)
            .ProducesProblem(StatusCodes.Status429TooManyRequests)
            .AddEndpointFilter<ScoreRateLimitFilter.Writes>();

        group.MapPut("/{id:guid}", Update)
            .WithName("UpdateScore")
            .Produces<ScoreSaved>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge)
            .ProducesProblem(StatusCodes.Status428PreconditionRequired)
            .ProducesProblem(StatusCodes.Status429TooManyRequests)
            .AddEndpointFilter<ScoreRateLimitFilter.Writes>();

        group.MapPatch("/{id:guid}", Rename)
            .WithName("RenameScore")
            .Produces<ScoreSaved>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status428PreconditionRequired)
            .ProducesProblem(StatusCodes.Status429TooManyRequests)
            .AddEndpointFilter<ScoreRateLimitFilter.Writes>();

        group.MapPost("/{id:guid}/duplicate", Duplicate)
            .WithName("DuplicateScore")
            .Produces<ScoreSummary>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status429TooManyRequests)
            .AddEndpointFilter<ScoreRateLimitFilter.Writes>();

        group.MapDelete("/{id:guid}", Delete)
            .WithName("DeleteScore")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status429TooManyRequests)
            .AddEndpointFilter<ScoreRateLimitFilter.Writes>();

        return app;
    }

    private static async Task<IResult> List(
        ICurrentUser user,
        ScoreStore store,
        string? q,
        int? page,
        int? pageSize,
        CancellationToken ct)
    {
        if (user.UserId is not { } owner)
        {
            return Results.Unauthorized();
        }

        int p = page ?? 1;
        int size = pageSize ?? ScoreLimits.DefaultPageSize;
        string? search = q?.Trim();
        if (p is < 1 or > 100_000 || size is < 1 or > ScoreLimits.MaxPageSize
            || search?.Length > ScoreLimits.MaxSearchLength || (search is not null && ScoreTitle.TrySanitize(search) is null))
        {
            return Problem(
                StatusCodes.Status400BadRequest,
                "Invalid query",
                $"page must be 1 or more, pageSize between 1 and {ScoreLimits.MaxPageSize}, q at most {ScoreLimits.MaxSearchLength} characters.");
        }

        return Results.Ok(await store.ListAsync(owner, search, p, size, ct));
    }

    private static async Task<IResult> Get(
        HttpContext context, Guid id, ICurrentUser user, ScoreStore store, CancellationToken ct)
    {
        if (user.UserId is not { } owner)
        {
            return Results.Unauthorized();
        }

        long? known = FirstVersion(context.Request.Headers.IfNoneMatch.ToString());
        ScoreResult<ScoreContent> result = await store.GetContentAsync(owner, id, known, ct);
        if (!result.IsOk)
        {
            return NotFound();
        }

        ScoreContent content = result.Value!;
        context.Response.Headers.ETag = ETag(content.Version);
        context.Response.Headers.CacheControl = "private, no-cache";
        if (content.Body is null)
        {
            return Results.StatusCode(StatusCodes.Status304NotModified);
        }

        // Streamed straight from the database; the lease releases the connection when the body is written.
        await using (content.Lease)
        {
            context.Response.ContentType = MediaTypeNames.Application.Json;
            await content.Body.CopyToAsync(context.Response.Body, ct);
        }

        return Results.Empty;
    }

    private static async Task<IResult> Create(
        HttpContext context, ICurrentUser user, ScoreStore store, IScoreContentValidator validator, CancellationToken ct)
    {
        if (user.UserId is not { } owner)
        {
            return Results.Unauthorized();
        }

        (ScoreDocument? document, IResult? error) = await ReadDocumentAsync(context, validator, ct);
        if (document is null)
        {
            return error!;
        }

        ScoreResult<ScoreSummary> result = await store.CreateAsync(owner, document, ct);
        return Created(context, result);
    }

    private static async Task<IResult> Update(
        HttpContext context, Guid id, ICurrentUser user, ScoreStore store, IScoreContentValidator validator, CancellationToken ct)
    {
        if (user.UserId is not { } owner)
        {
            return Results.Unauthorized();
        }

        // Cheap checks first: nothing is read or parsed for a request that cannot succeed.
        if (RequireVersion(context) is not { } expected)
        {
            return PreconditionProblem(context);
        }

        (ScoreDocument? document, IResult? error) = await ReadDocumentAsync(context, validator, ct);
        if (document is null)
        {
            return error!;
        }

        ScoreResult<ScoreSaved> result = await store.UpdateContentAsync(owner, id, expected, document, ct);
        return Saved(context, result);
    }

    private static async Task<IResult> Rename(
        HttpContext context, Guid id, RenameRequest? body, ICurrentUser user, ScoreStore store, CancellationToken ct)
    {
        if (user.UserId is not { } owner)
        {
            return Results.Unauthorized();
        }

        if (RequireVersion(context) is not { } expected)
        {
            return PreconditionProblem(context);
        }

        string? title = ScoreTitle.TrySanitize(body?.Title);
        if (string.IsNullOrEmpty(title))
        {
            return Problem(
                StatusCodes.Status400BadRequest,
                "Invalid title",
                $"The title must be 1 to {ScoreLimits.MaxTitleLength} characters, without control characters.");
        }

        ScoreResult<ScoreSaved> result = await store.RenameAsync(owner, id, title, expected, ct);
        return Saved(context, result);
    }

    private static async Task<IResult> Duplicate(
        HttpContext context, Guid id, ICurrentUser user, ScoreStore store, CancellationToken ct)
    {
        if (user.UserId is not { } owner)
        {
            return Results.Unauthorized();
        }

        return Created(context, await store.DuplicateAsync(owner, id, ct));
    }

    private static async Task<IResult> Delete(Guid id, ICurrentUser user, ScoreStore store, CancellationToken ct)
    {
        if (user.UserId is not { } owner)
        {
            return Results.Unauthorized();
        }

        return await store.DeleteAsync(owner, id, ct) ? Results.NoContent() : NotFound();
    }

    private static async Task<(ScoreDocument?, IResult?)> ReadDocumentAsync(
        HttpContext context, IScoreContentValidator validator, CancellationToken ct)
    {
        if (!context.Request.HasJsonContentType())
        {
            return (null, Problem(StatusCodes.Status415UnsupportedMediaType, "Unsupported media type", "Send the score as application/json."));
        }

        // Only encodings the decompression middleware handles; anything else would be parsed as raw JSON.
        foreach (string? encoding in context.Request.Headers.ContentEncoding)
        {
            if (!string.IsNullOrEmpty(encoding) && !AllowedEncodings.Contains(encoding.Trim()))
            {
                return (null, Problem(StatusCodes.Status415UnsupportedMediaType, "Unsupported content encoding", "Use gzip, br, deflate or no encoding."));
            }
        }

        ReadOnlyMemory<byte>? body;
        try
        {
            body = await BoundedBody.ReadAsync(context, ct);
        }
        catch (InvalidDataException)
        {
            // Corrupt gzip or Brotli stream.
            return (null, Problem(StatusCodes.Status400BadRequest, "Invalid body", "The compressed request body is corrupt."));
        }

        if (body is null)
        {
            return (null, Problem(
                StatusCodes.Status413PayloadTooLarge,
                "Request body too large",
                string.Create(CultureInfo.InvariantCulture, $"A score is limited to {ScoreLimits.MaxContentBytes} bytes.")));
        }

        ScoreValidationResult validation = validator.Validate(body.Value);
        return validation.IsValid
            ? (validation.Document, null)
            : (null, Problem(StatusCodes.Status400BadRequest, "Invalid score", validation.Error));
    }

    private static IResult Created(HttpContext context, ScoreResult<ScoreSummary> result)
    {
        switch (result.Outcome)
        {
            case ScoreOutcome.Ok:
                ScoreSummary summary = result.Value!;
                context.Response.Headers.ETag = ETag(summary.Version);
                return Results.Created($"/api/scores/{summary.Id}", summary);
            case ScoreOutcome.QuotaExceeded:
                return Problem(StatusCodes.Status409Conflict, "Score limit reached", "Delete a score before creating another one.", QuotaProblemType);
            case ScoreOutcome.InvalidContent:
                return Problem(StatusCodes.Status400BadRequest, "Invalid score", "The score contains characters that cannot be stored.");
            default:
                return NotFound();
        }
    }

    private static IResult Saved(HttpContext context, ScoreResult<ScoreSaved> result)
    {
        switch (result.Outcome)
        {
            case ScoreOutcome.Ok:
                ScoreSaved saved = result.Value!;
                context.Response.Headers.ETag = ETag(saved.Version);
                return Results.Ok(saved);
            case ScoreOutcome.Conflict:
                return Problem(
                    StatusCodes.Status409Conflict,
                    "Version conflict",
                    "The score changed since your copy. Reload it (GET) and retry with the new ETag.",
                    ConflictProblemType);
            case ScoreOutcome.InvalidContent:
                return Problem(StatusCodes.Status400BadRequest, "Invalid score", "The score contains characters that cannot be stored.");
            default:
                return NotFound();
        }
    }

    // The same answer whether the score is missing or owned by someone else.
    private static IResult NotFound() => Problem(StatusCodes.Status404NotFound, "Not Found", null);

    private static IResult PreconditionProblem(HttpContext context) =>
        context.Request.Headers.ContainsKey("If-Match")
            ? Problem(StatusCodes.Status400BadRequest, "Invalid If-Match", "If-Match must be the ETag of the score, for example \"3\".")
            : Problem(StatusCodes.Status428PreconditionRequired, "Precondition required", "Send If-Match with the ETag of the version you are changing.");

    private static IResult Problem(int status, string title, string? detail, string? type = null) =>
        Results.Problem(statusCode: status, title: title, detail: detail, type: type);

    private static string ETag(long version) => $"\"{version.ToString(CultureInfo.InvariantCulture)}\"";

    private static long? RequireVersion(HttpContext context) =>
        FirstVersion(context.Request.Headers.IfMatch.ToString());

    /// <summary>
    /// Parses the first entity tag of an <c>If-Match</c> / <c>If-None-Match</c> value. A weak prefix is accepted
    /// because response compression may weaken the tag it sends. Anything that is not a version is <c>null</c>.
    /// </summary>
    internal static long? FirstVersion(string? header)
    {
        if (string.IsNullOrWhiteSpace(header) || header.Length > 64)
        {
            return null;
        }

        ReadOnlySpan<char> tag = header.AsSpan().Trim();
        int comma = tag.IndexOf(',');
        if (comma >= 0)
        {
            tag = tag[..comma].Trim();
        }

        if (tag.StartsWith("W/", StringComparison.Ordinal))
        {
            tag = tag[2..];
        }

        return tag.Length >= 3 && tag[0] == '"' && tag[^1] == '"'
            && long.TryParse(tag[1..^1], NumberStyles.None, CultureInfo.InvariantCulture, out long version)
            && version > 0
                ? version
                : null;
    }

    internal sealed record RenameRequest(string? Title);

}
