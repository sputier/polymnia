using System.Net.Mime;
using Polymnia.Api.Hosting;
using Polymnia.Api.Scores;
using Polymnia.Core.Scores;
using Polymnia.Core.Sharing;
using Polymnia.Infrastructure.Scores;
using Polymnia.Infrastructure.Sharing;

namespace Polymnia.Api.Sharing;

/// <summary>
/// Read-only share links.
/// <list type="bullet">
/// <item><c>/api/scores/{id}/share</c>: the owner's management endpoints (session, antiforgery, per-user budgets).
/// A score owned by someone else answers 404, like a missing one.</item>
/// <item><c>GET /api/shared</c> with the token in the <c>X-Share-Token</c> header (never in the URL, so no access log, log
/// scope or Referer can carry it): the public endpoint. No session: the token is the only credential. Read-only
/// by construction (GET only, and it reads nothing but the one score behind the token).</item>
/// </list>
/// </summary>
internal static class ShareEndpoints
{
    public const string SharedPath = "/api/shared";

    public const string TokenHeader = "X-Share-Token";

    public static IEndpointRouteBuilder MapShareEndpoints(this IEndpointRouteBuilder app)
    {
        RouteGroupBuilder owner = app.MapGroup("/api/scores/{id:guid}/share").RequireAuthorization();

        owner.MapGet("/", GetStatus)
            .WithName("GetShareStatus")
            .Produces<ShareStatus>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .AddEndpointFilter<ScoreRateLimitFilter.Reads>();

        // The response carries the raw token: never compressed (BREACH rule), never cached.
        owner.MapPost("/", Create)
            .WithName("CreateShareLink")
            .Produces<ShareCreated>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status429TooManyRequests)
            .AddEndpointFilter<ScoreRateLimitFilter.Writes>()
            .DisableResponseCompression();

        owner.MapDelete("/", Revoke)
            .WithName("RevokeShareLink")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status429TooManyRequests)
            .AddEndpointFilter<ScoreRateLimitFilter.Writes>();

        // The token is not echoed in any response body, so compression stays on (a large score compresses well, and
        // BREACH needs a secret next to attacker-chosen text in the same body).
        app.MapGet(SharedPath, GetShared)
            .WithName("GetSharedScore")
            .Produces(StatusCodes.Status200OK, contentType: MediaTypeNames.Application.Json)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);

        return app;
    }

    private static async Task<IResult> GetStatus(Guid id, ICurrentUser user, ShareStore store, CancellationToken ct)
    {
        if (user.UserId is not { } owner)
        {
            return Results.Unauthorized();
        }

        ScoreResult<ShareStatus> result = await store.GetStatusAsync(owner, id, ct);
        return result.IsOk ? Results.Ok(result.Value) : NotFound();
    }

    private static async Task<IResult> Create(
        HttpContext context, Guid id, ICurrentUser user, ShareStore store, ILoggerFactory loggers, CancellationToken ct)
    {
        if (user.UserId is not { } owner)
        {
            return Results.Unauthorized();
        }

        ScoreResult<ShareCreated> result = await store.CreateAsync(owner, id, ct);
        context.Response.Headers.CacheControl = "no-store";
        switch (result.Outcome)
        {
            case ScoreOutcome.Ok:
                ILogger logger = loggers.CreateLogger(ShareLog.Category);
                ShareLog.Created(logger, owner, id);
                return Results.Json(result.Value, statusCode: StatusCodes.Status201Created);
            case ScoreOutcome.Conflict:
                return Results.Problem(
                    statusCode: StatusCodes.Status409Conflict,
                    title: "Conflict",
                    detail: "The link of this score is being changed. Retry.");
            default:
                return NotFound();
        }
    }

    private static async Task<IResult> Revoke(
        Guid id, ICurrentUser user, ShareStore store, ILoggerFactory loggers, CancellationToken ct)
    {
        if (user.UserId is not { } owner)
        {
            return Results.Unauthorized();
        }

        if (!await store.RevokeAsync(owner, id, ct))
        {
            return NotFound();
        }

        ILogger logger = loggers.CreateLogger(ShareLog.Category);
        ShareLog.Revoked(logger, owner, id);
        return Results.NoContent();
    }

    private static async Task<IResult> GetShared(
        HttpContext context, [Microsoft.AspNetCore.Mvc.FromHeader(Name = TokenHeader)] string? token, ScoreStore store, CancellationToken ct)
    {
        // Set before anything can fail, so the 404 carries the same headers as the 200. The headers are repeated by
        // SecurityHeadersMiddleware for Referrer-Policy (it owns that header and sets "no-referrer" on this path).
        IHeaderDictionary headers = context.Response.Headers;
        headers.CacheControl = "no-store";
        headers["X-Robots-Tag"] = "noindex, nofollow, noarchive";

        // A malformed token cannot match anything: no database round trip. The shape is public, so this leaks nothing.
        if (!ShareToken.IsWellFormed(token))
        {
            return NotFound();
        }

        // Lookup by the SHA-256 hash of the token on a unique index: nothing is compared byte by byte against a
        // secret in application code, so there is no secret-dependent timing to observe.
        ScoreResult<ScoreContent> result = await store.OpenSharedContentAsync(ShareToken.Hash(token), ct);
        if (!result.IsOk)
        {
            return NotFound();
        }

        // Streamed straight from the database, like GET /api/scores/{id}.
        await using (result.Value!.Lease)
        {
            using CancellationTokenSource deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
            deadline.CancelAfter(TimeSpan.FromSeconds(20));
            context.Response.ContentType = MediaTypeNames.Application.Json;
            await result.Value.Body!.CopyToAsync(context.Response.Body, deadline.Token);
        }

        return Results.Empty;
    }

    // The same answer whether the score is missing, owned by someone else, or the token unknown or revoked.
    private static IResult NotFound() => Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Not Found");
}
