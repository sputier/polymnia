using System.Globalization;
using System.IO.Compression;
using System.Net.Mime;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Polymnia.Api.Auth;
using Polymnia.Api.Hosting;
using Polymnia.Core.Scores;
using Polymnia.Core.Users;
using Polymnia.Infrastructure.Scores;
using Polymnia.Infrastructure.Users;
using Microsoft.Extensions.Options;

namespace Polymnia.Api.Account;

/// <summary>
/// The signed-in user's rights over their own data (GDPR): <c>DELETE /api/me</c> (erasure) and
/// <c>GET /api/me/export</c> (access and portability). Both act on the user taken from the session, never from
/// the request. See docs/privacy.md.
/// </summary>
internal static class AccountEndpoints
{
    /// <summary>Machine-readable <c>code</c> of the 403 problem: the session is too old for this action.</summary>
    public const string ReauthProblemCode = "reauth-required";

    private static readonly TimeSpan ExportDeadline = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan ScoreDeadline = TimeSpan.FromSeconds(20);

    private static readonly JsonSerializerOptions ProfileJson = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    public static IServiceCollection AddAccount(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.AddSingleton<AccountRateLimiters>();
        return services;
    }

    public static IEndpointRouteBuilder MapAccountEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.MapDelete("/api/me", DeleteAccount)
            .WithName("DeleteAccount")
            .RequireAuthorization()
            .AddEndpointFilter<AccountRateLimitFilter.Delete>()
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);

        app.MapGet("/api/me/export", ExportData)
            .WithName("ExportData")
            .RequireAuthorization()
            .WithMetadata(new HttpMethodMetadata(["GET"]))
            .AddEndpointFilter<AccountRateLimitFilter.Export>()
            // A ZIP is already compressed, and the response must never be stored or shared.
            .DisableResponseCompression()
            .Produces(StatusCodes.Status200OK, contentType: MediaTypeNames.Application.Zip)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);

        return app;
    }

    /// <summary>Whether the session's sign-in is recent enough (<see cref="AuthOptions.RecentSignInWindow"/>).</summary>
    internal static bool SignedInRecently(ClaimsPrincipal user, TimeProvider time, TimeSpan window)
    {
        // A session without the claim (created before it existed) is not recent: it signs in again.
        if (!long.TryParse(user.FindFirstValue(AuthDefaults.AuthTimeClaim), NumberStyles.None, CultureInfo.InvariantCulture, out long seconds)
            || seconds > DateTimeOffset.MaxValue.ToUnixTimeSeconds() / 2)
        {
            return false;
        }

        DateTimeOffset signedIn = DateTimeOffset.FromUnixTimeSeconds(seconds);
        DateTimeOffset now = time.GetUtcNow();
        return signedIn <= now.AddMinutes(1) && now - signedIn <= window;
    }

    private static async Task<IResult> DeleteAccount(
        HttpContext context,
        ICurrentUser current,
        AccountStore accounts,
        TimeProvider time,
        IOptions<AuthOptions> auth,
        ILoggerFactory loggers,
        CancellationToken ct)
    {
        if (current.UserId is not { } userId)
        {
            return Results.Unauthorized();
        }

        ILogger audit = loggers.CreateLogger(AuthLog.Category);
        if (!SignedInRecently(context.User, time, auth.Value.RecentSignInWindow))
        {
            AuthLog.ReauthRequired(audit, userId);
            return Results.Problem(
                statusCode: StatusCodes.Status403Forbidden,
                title: "Sign in again to delete your account.",
                detail: "Deleting the account requires a recent sign-in with Google.",
                extensions: new Dictionary<string, object?> { ["code"] = ReauthProblemCode });
        }

        // Not tied to the request: once the person confirmed, a closed tab must not leave a half-done erasure.
        // One statement; the database cascades to scores, sessions and everything else that references the user.
        bool deleted = await accounts.DeleteAsync(userId, CancellationToken.None);
        if (deleted)
        {
            AuthLog.AccountDeleted(audit, userId);
        }

        // The session row is gone with the user; this clears the browser's cookies too.
        await context.SignOutAsync(AuthDefaults.CookieScheme);
        context.Response.Cookies.Delete(AuthDefaults.RequestTokenCookieName, new CookieOptions { Secure = true, Path = "/" });
        context.Response.Cookies.Delete(AuthDefaults.AntiforgeryCookieName, new CookieOptions { Secure = true, Path = "/" });
        context.Response.Headers.CacheControl = "no-store";
        return TypedResults.NoContent();
    }

    private static async Task<IResult> ExportData(
        HttpContext context,
        ICurrentUser current,
        AccountStore accounts,
        ScoreStore scores,
        TimeProvider time,
        ILoggerFactory loggers,
        CancellationToken ct)
    {
        if (current.UserId is not { } userId)
        {
            return Results.Unauthorized();
        }

        AccountProfile? profile = await accounts.GetProfileAsync(userId, ct);
        if (profile is null)
        {
            return Results.Unauthorized();
        }

        IReadOnlyList<ScoreExportRow> rows = await accounts.ListScoresAsync(userId, ct);
        DateTimeOffset now = time.GetUtcNow();
        ILogger audit = loggers.CreateLogger(AuthLog.Category);

        HttpResponse response = context.Response;
        response.ContentType = MediaTypeNames.Application.Zip;
        response.Headers.CacheControl = "no-store";
        response.Headers.ContentDisposition =
            $"attachment; filename=\"polymnia-export-{now.ToString("yyyyMMdd", CultureInfo.InvariantCulture)}.zip\"";

        using CancellationTokenSource deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(ExportDeadline);
        int written = 0;
        try
        {
            // Streamed: the archive goes to the client as it is built, one score at a time (each document is
            // read from PostgreSQL as bytes and copied through a small buffer), so memory does not grow with the library.
            await using var output = new SyncTolerantStream(response.Body);
            await using ZipArchive zip = await ZipArchive.CreateAsync(
                output, ZipArchiveMode.Create, leaveOpen: true, entryNameEncoding: Encoding.UTF8, deadline.Token);

            List<ExportedScoreEntry> index = [.. rows.Select(r => new ExportedScoreEntry(
                r.Id, r.Title, r.SchemaVersion, r.Version, r.CreatedAt, r.UpdatedAt, ScoreFileName(r)))];
            await WriteEntryAsync(zip, "profile.json", now, async stream =>
                await JsonSerializer.SerializeAsync(stream, new ExportProfile(1, now, profile, index), ProfileJson, deadline.Token), deadline.Token);

            foreach (ExportedScoreEntry entry in index)
            {
                ScoreResult<ScoreContent> result = await scores.GetContentAsync(userId, entry.Id, null, deadline.Token);
                if (!result.IsOk || result.Value!.Body is null)
                {
                    continue; // Deleted since the list was read.
                }

                await using (result.Value.Lease)
                {
                    using CancellationTokenSource one = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token);
                    one.CancelAfter(ScoreDeadline);
                    await WriteEntryAsync(zip, entry.File, entry.UpdatedAt, stream => result.Value.Body.CopyToAsync(stream, one.Token), one.Token);
                }

                written++;
            }

            // Writes the central directory, then sends what ZipArchive wrote synchronously.
            await zip.DisposeAsync();
            await output.FlushAsync(deadline.Token);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            // Headers and part of the archive are already sent: cut the connection so the client sees a failed
            // download, never a truncated file that looks complete.
            AuthLog.DataExportFailed(audit, userId, ex);
            context.Abort();
            return Results.Empty;
        }

        AuthLog.DataExported(audit, userId, written);
        return Results.Empty;
    }

    private static async Task WriteEntryAsync(
        ZipArchive zip, string name, DateTimeOffset modified, Func<Stream, Task> write, CancellationToken ct)
    {
        ZipArchiveEntry entry = zip.CreateEntry(name, CompressionLevel.Fastest);
        entry.LastWriteTime = modified.Year < 1980 ? new DateTimeOffset(1980, 1, 1, 0, 0, 0, TimeSpan.Zero) : modified;
        Stream stream = await entry.OpenAsync(ct);
        await using (stream)
        {
            await write(stream);
        }
    }

    /// <summary>
    /// <c>scores/&lt;title&gt;-&lt;id&gt;.json</c>. The title is reduced to letters, digits and a few separators and
    /// the id is appended, so the name is unique, never starts with a dot and cannot move out of <c>scores/</c>.
    /// </summary>
    internal static string ScoreFileName(ScoreExportRow row)
    {
        var name = new StringBuilder(64);
        foreach (char c in row.Title)
        {
            if (name.Length >= 60)
            {
                break;
            }

            name.Append(char.IsAsciiLetterOrDigit(c) ? c : c is ' ' or '-' or '_' ? '-' : '_');
        }

        string stem = name.ToString().Trim('-', '_');
        return string.Create(CultureInfo.InvariantCulture, $"scores/{(stem.Length == 0 ? "score" : stem)}-{row.Id:N}.json");
    }

    private sealed record ExportedScoreEntry(
        Guid Id, string Title, int SchemaVersion, long Version, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, string File);

    /// <summary><c>profile.json</c>: the account data and the list of the score files. No credential is in it.</summary>
    private sealed record ExportProfile(
        int FormatVersion, DateTimeOffset ExportedAt, AccountProfile Account, IReadOnlyList<ExportedScoreEntry> Scores);
}
