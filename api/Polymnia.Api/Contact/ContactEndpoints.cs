using System.Text.Json;
using Polymnia.Api.Hosting;
using Polymnia.Api.Scores;
using Microsoft.Extensions.Options;
using Polymnia.Core.Contact;
using Polymnia.Infrastructure.Contact;

namespace Polymnia.Api.Contact;

/// <summary>The JSON body of <c>POST /api/contact</c>. Unknown properties are ignored; every value is validated.</summary>
internal sealed record ContactRequest(string? Topic, string? Message, string? ReplyTo, string? Website, string? Token);

/// <summary>What <c>GET /api/contact/form-token</c> returns.</summary>
internal sealed record ContactFormTokenResponse(string Token, int MinFillSeconds);

/// <summary>
/// The contact form (docs/contact.md): <c>GET /api/contact/form-token</c> hands out a signed, short-lived token and
/// <c>POST /api/contact</c> stores a message (202) that a background service forwards by e-mail. Both are public.
/// The POST is the only unsafe <c>/api</c> route that does not need the antiforgery header: a signed-out visitor has no
/// antiforgery cookie, and the form token (which a page of another site cannot read) plays that role.
/// </summary>
internal static class ContactEndpoints
{
    public const string Path = "/api/contact";

    private static readonly JsonSerializerOptions WebOptions = new(JsonSerializerDefaults.Web);

    /// <summary>The body is a few fields of at most 2 000 characters: 16 KiB is plenty even in 4-byte characters.</summary>
    public const int MaxBodyBytes = 16 * 1024;

    /// <summary>Machine-readable <c>code</c> of the 400 problem for a missing, forged, early or expired token.</summary>
    public const string TokenProblemCode = "contact-token";

    public static IServiceCollection AddContact(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.AddOptions<ContactOptions>().Bind(configuration.GetSection(ContactOptions.SectionName)).ValidateOnStart();
        services.AddSingleton<IValidateOptions<ContactOptions>, ContactOptionsValidator>();
        services.AddSingleton<ContactFormTokens>();
        services.AddSingleton<ContactRateLimiters>();
        services.AddSingleton<ContactQueueSignal>();
        services.AddSingleton<IContactMailTransport, SmtpContactMailTransport>();
        services.AddSingleton<ContactForwarder>();
        services.AddHostedService(static sp => sp.GetRequiredService<ContactForwarder>());
        services.AddSingleton<ContactPurgeService>();
        services.AddHostedService(static sp => sp.GetRequiredService<ContactPurgeService>());
        return services;
    }

    /// <summary>True for <c>/api/contact</c> and <c>/api/contact/</c>: the one route the antiforgery middleware lets through.</summary>
    public static bool IsSubmitPath(PathString path) =>
        path.StartsWithSegments(Path, StringComparison.OrdinalIgnoreCase, out PathString rest) && (!rest.HasValue || rest.Value == "/");

    public static IEndpointRouteBuilder MapContactEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        // The response carries a token: never compressed (BREACH rule) and never cached.
        app.MapGet(Path + "/form-token", IssueToken)
            .WithName("GetContactFormToken")
            .Produces<ContactFormTokenResponse>()
            .ProducesProblem(StatusCodes.Status429TooManyRequests)
            .DisableResponseCompression();

        app.MapPost(Path, Submit)
            .WithName("SendContactMessage")
            .Produces(StatusCodes.Status202Accepted)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status429TooManyRequests);

        return app;
    }

    private static async Task<IResult> IssueToken(
        HttpContext context, ContactFormTokens tokens, ContactRateLimiters limiters, IOptions<ContactOptions> options, CancellationToken ct)
    {
        context.Response.Headers.CacheControl = "no-store";
        if (await limiters.TryIssueTokenAsync(ContactRateLimiters.Key(context), ct) is { } denied)
        {
            return TooMany(context, denied);
        }

        return Results.Json(new ContactFormTokenResponse(tokens.Issue(), options.Value.MinFillSeconds));
    }

    private static async Task<IResult> Submit(
        HttpContext context,
        ContactFormTokens tokens,
        ContactRateLimiters limiters,
        ContactStore store,
        ContactQueueSignal signal,
        IOptions<ContactOptions> options,
        ILoggerFactory loggers,
        CancellationToken ct)
    {
        ILogger logger = loggers.CreateLogger(ContactLog.Category);
        context.Response.Headers.CacheControl = "no-store";

        // The address budget first: every submission costs, whatever it holds (a bot that fills the honeypot included).
        if (await limiters.TryAddressAsync(ContactRateLimiters.Key(context), ct) is { } denied)
        {
            ContactLog.RateLimited(logger, denied.Scope);
            return TooMany(context, denied);
        }

        if (!context.Request.HasJsonContentType())
        {
            return Results.Problem(statusCode: StatusCodes.Status415UnsupportedMediaType, title: "Unsupported Media Type", detail: "Send application/json.");
        }

        // Read by hand, bounded: the limit holds for a declared length and for a chunked body alike.
        ReadOnlyMemory<byte>? body = await BoundedBody.ReadAsync(context, ct, MaxBodyBytes);
        if (body is null)
        {
            return Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge, title: "Payload Too Large");
        }

        ContactRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<ContactRequest>(body.Value.Span, WebOptions);
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            // Broken JSON, or text the reader cannot decode (a lone surrogate in an escape).
            return Invalid("body", "invalid-json");
        }

        if (request is null)
        {
            return Invalid("body", "required");
        }

        if (tokens.Validate(request.Token) != FormTokenResult.Valid)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "Missing, invalid or expired form token.",
                detail: "Fetch a new token with GET /api/contact/form-token.",
                extensions: new Dictionary<string, object?> { ["code"] = TokenProblemCode });
        }

        // A hidden field no person sees or fills: a robot that does gets the same answer as everyone, and nothing is stored.
        if (!string.IsNullOrEmpty(request.Website))
        {
            ContactLog.Honeypot(logger);
            return Results.Accepted();
        }

        if (await limiters.TryGlobalAsync(ct) is { } globalDenied)
        {
            ContactLog.RateLimited(logger, globalDenied.Scope);
            return TooMany(context, globalDenied);
        }

        Dictionary<string, string[]> errors = [];
        if (!ContactTopics.TryParse(request.Topic, out ContactTopic topic))
        {
            errors["topic"] = ["invalid"];
        }

        string? text = request.Message is null ? null : ContactText.Clean(request.Message);
        if (string.IsNullOrWhiteSpace(request.Message))
        {
            errors["message"] = ["required"];
        }
        else if (text is null)
        {
            errors["message"] = ["invalid-characters"];
        }
        else if (text.Length == 0)
        {
            errors["message"] = ["required"];
        }
        else if (text.Length > ContactLimits.MaxMessageLength)
        {
            errors["message"] = ["too-long"];
        }

        string? replyTo = string.IsNullOrWhiteSpace(request.ReplyTo) ? null : request.ReplyTo.Trim();
        if (replyTo is not null && !ContactAddress.IsValid(replyTo))
        {
            errors["replyTo"] = ["invalid"];
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        Guid id = await store.AddAsync(topic, text!, replyTo, options.Value.SmtpConfigured, ct);
        ContactLog.Stored(logger, id);
        signal.Notify();
        return Results.Accepted();
    }

    private static IResult Invalid(string field, string code) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [code] });

    private static IResult TooMany(HttpContext context, Refusal denied)
    {
        context.Response.Headers.RetryAfter = ContactRateLimiters.RetryAfter(denied);
        return Results.Problem(
            statusCode: StatusCodes.Status429TooManyRequests,
            title: "Too many requests",
            detail: "Retry after the delay in Retry-After.");
    }
}
