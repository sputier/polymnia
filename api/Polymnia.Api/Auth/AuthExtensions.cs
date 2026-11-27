using System.Globalization;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using System.Security.Claims;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.Extensions.Options;
using Polymnia.Api.Hosting;
using Polymnia.Infrastructure;

namespace Polymnia.Api.Auth;

internal static class AuthExtensions
{
    private const string GoogleAuthority = "https://accounts.google.com";

    /// <summary>
    /// Google sign-in (OpenID Connect, authorization code flow with PKCE, nonce and state), a server-side session,
    /// persisted Data Protection keys and header-based antiforgery.
    /// <c>AddOpenIdConnect</c> is used rather than <c>AddGoogle</c>: it validates the signed ID token (issuer, audience,
    /// signature from Google's published keys, expiry, nonce) and needs no extra user-info call, so only the claims
    /// <c>sub</c>, <c>name</c> and <c>picture</c> are ever read. The Google scheme is not registered when no client is
    /// configured (Development and tests); Production refuses to start in that case.
    /// </summary>
    public static IServiceCollection AddPolymniaAuth(
        this IServiceCollection services,
        IConfiguration configuration,
        IWebHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        IConfigurationSection section = configuration.GetSection(AuthOptions.SectionName);
        services.AddOptions<AuthOptions>().Bind(section).ValidateOnStart();
        services.AddSingleton<IValidateOptions<AuthOptions>>(new AuthOptionsValidator(environment, configuration));
        AuthOptions auth = section.Get<AuthOptions>() ?? new();

        // Keys live in PostgreSQL: cookies and antiforgery tokens survive restarts and work across containers.
        // Outside Development they are encrypted at rest with a certificate (the options validator requires it).
        IDataProtectionBuilder dataProtection = services.AddDataProtection()
            .SetApplicationName(AuthDefaults.DataProtectionApplicationName)
            .PersistKeysToDbContext<PolymniaDbContext>();
        string? keyCertificatePath = configuration["DataProtection:CertificatePath"];
        if (!string.IsNullOrWhiteSpace(keyCertificatePath))
        {
            dataProtection.ProtectKeysWithCertificate(
                LoadKeyCertificate(keyCertificatePath, configuration["DataProtection:CertificatePassword"]));
        }

        services.AddOptions<RateLimiterOptions>().Configure<IOptions<AuthOptions>, ILoggerFactory>(ConfigureRateLimiter);
        services.AddRateLimiter(static _ => { });

        services.AddAntiforgery(options =>
        {
            options.HeaderName = AuthDefaults.RequestTokenHeaderName;
            options.Cookie.Name = AuthDefaults.AntiforgeryCookieName;
            options.Cookie.HttpOnly = true;
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            options.Cookie.SameSite = SameSiteMode.Strict;
            options.Cookie.Path = "/";
        });

        services.AddSingleton<DbTicketStore>();
        services.AddHostedService<SessionCleanupService>();

        AuthenticationBuilder authentication = services
            .AddAuthentication(options =>
            {
                options.DefaultScheme = AuthDefaults.CookieScheme;
                options.DefaultChallengeScheme = AuthDefaults.CookieScheme;
            })
            .AddCookie(AuthDefaults.CookieScheme, options =>
            {
                options.Cookie.Name = AuthDefaults.SessionCookieName;
                options.Cookie.HttpOnly = true;
                options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
                options.Cookie.SameSite = SameSiteMode.Lax; // Lax: the cookie must come back on the redirect from Google.
                options.Cookie.Path = "/";
                options.Cookie.IsEssential = true;
                options.ExpireTimeSpan = auth.IdleTimeout;
                options.SlidingExpiration = true;
                options.Events.OnValidatePrincipal = SessionEvents.OnValidatePrincipal;
                options.Events.OnRedirectToLogin = SessionEvents.OnRedirectToLogin;
                options.Events.OnRedirectToAccessDenied = SessionEvents.OnRedirectToAccessDenied;
            });

        services.AddOptions<CookieAuthenticationOptions>(AuthDefaults.CookieScheme)
            .Configure<DbTicketStore>((options, store) => options.SessionStore = store);

        if (auth.GoogleConfigured)
        {
            // A null redirect URI is reported by the options validator at start-up.
            string redirectUri = auth.RedirectUri ?? string.Empty;
            authentication.AddOpenIdConnect(AuthDefaults.GoogleScheme, options =>
            {
                options.SignInScheme = AuthDefaults.CookieScheme;
                options.Authority = GoogleAuthority;
                options.ClientId = auth.Google.ClientId;
                options.ClientSecret = auth.Google.ClientSecret;
                options.ResponseType = OpenIdConnectResponseType.Code;
                options.ResponseMode = OpenIdConnectResponseMode.Query;
                options.UsePkce = true;
                options.Scope.Clear();
                options.Scope.Add("openid");
                options.Scope.Add("profile");
                options.CallbackPath = AuthDefaults.CallbackPath;
                options.SaveTokens = false;
                options.GetClaimsFromUserInfoEndpoint = false;
                options.MapInboundClaims = false;
                options.RequireHttpsMetadata = true;

                // Lax so that the cookies come back on the top-level redirect from Google; __Host- needs Path=/.
                options.CorrelationCookie.Name = AuthDefaults.CorrelationCookiePrefix;
                options.CorrelationCookie.Path = "/";
                options.CorrelationCookie.SameSite = SameSiteMode.Lax;
                options.CorrelationCookie.SecurePolicy = CookieSecurePolicy.Always;
                options.CorrelationCookie.HttpOnly = true;
                options.NonceCookie.Name = AuthDefaults.NonceCookiePrefix;
                options.NonceCookie.Path = "/";
                options.NonceCookie.SameSite = SameSiteMode.Lax;
                options.NonceCookie.SecurePolicy = CookieSecurePolicy.Always;
                options.NonceCookie.HttpOnly = true;

                // Leftover cookies of abandoned sign-ins vanish quickly (also: a stale sign-in cannot be finished later).
                TimeSpan signInWindow = TimeSpan.FromMinutes(10);
                options.RemoteAuthenticationTimeout = signInWindow;
                options.CorrelationCookie.MaxAge = signInWindow;
                options.NonceCookie.MaxAge = signInWindow;
                options.ProtocolValidator.NonceLifetime = signInWindow;

                options.Events.OnRedirectToIdentityProvider = context =>
                {
                    // Never derived from the request Host header.
                    context.ProtocolMessage.RedirectUri = redirectUri;
                    return Task.CompletedTask;
                };
                options.Events.OnAuthorizationCodeReceived = context =>
                {
                    if (context.TokenEndpointRequest is not null)
                    {
                        context.TokenEndpointRequest.RedirectUri = redirectUri;
                    }

                    return Task.CompletedTask;
                };
                options.Events.OnTicketReceived = SessionEvents.OnTicketReceived;
                options.Events.OnRemoteFailure = SessionEvents.OnRemoteFailure;
            });
        }

        services.AddAuthorization();
        return services;
    }

    private static X509Certificate2 LoadKeyCertificate(string path, string? password)
    {
        try
        {
            return X509CertificateLoader.LoadPkcs12FromFile(path, password);
        }
        catch (Exception ex) when (ex is CryptographicException or IOException)
        {
            // No path or password in the message.
            throw new InvalidOperationException(
                "The Data Protection certificate could not be loaded: check DataProtection:CertificatePath and DataProtection:CertificatePassword.",
                ex);
        }
    }

    /// <summary>
    /// Per-IP fixed window on <c>/api/auth/*</c> (login, callback, antiforgery, logout): 429 with <c>Retry-After</c>.
    /// Everything else is not limited here.
    /// </summary>
    private static void ConfigureRateLimiter(RateLimiterOptions limiter, IOptions<AuthOptions> authOptions, ILoggerFactory loggers)
    {
        RateLimitOptions settings = authOptions.Value.RateLimit;
        ILogger logger = loggers.CreateLogger(AuthLog.Category);

        limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        limiter.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
            context.Request.Path.StartsWithSegments("/api/auth", StringComparison.OrdinalIgnoreCase)
                ? RateLimitPartition.GetFixedWindowLimiter(
                    context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = settings.PermitLimit,
                        Window = settings.Window,
                        QueueLimit = 0,
                        AutoReplenishment = true,
                    })
                : RateLimitPartition.GetNoLimiter("not-auth"));
        limiter.OnRejected = async (context, cancellationToken) =>
        {
            if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out TimeSpan retryAfter))
            {
                context.HttpContext.Response.Headers.RetryAfter =
                    Math.Ceiling(retryAfter.TotalSeconds).ToString(CultureInfo.InvariantCulture);
            }

            AuthLog.RateLimited(logger);
            await Results.Problem(statusCode: StatusCodes.Status429TooManyRequests, title: "Too many requests.")
                .ExecuteAsync(context.HttpContext);
        };
    }

    /// <summary>Authentication, then antiforgery, then authorization (the token is bound to the signed-in user).</summary>
    public static IApplicationBuilder UsePolymniaAuth(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.UseRateLimiter();
        app.UseAuthentication();
        app.UseMiddleware<ApiAntiforgeryMiddleware>();
        app.UseAuthorization();
        return app;
    }

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        HttpMethodMetadata get = new(["GET", "HEAD"]);

        endpoints.MapGet("/api/auth/login", (Delegate)Login).WithMetadata(get);

        endpoints.MapGet("/api/auth/antiforgery", IssueAntiforgeryToken)
            .WithMetadata(get)
            // The token is a secret: BREACH mitigation rule, never compressed.
            .DisableResponseCompression();

        endpoints.MapPost("/api/auth/logout", (Delegate)Logout);

        endpoints.MapGet("/api/me", GetMe).WithMetadata(get).RequireAuthorization();

        return endpoints;
    }

    private static async Task<IResult> Login(HttpContext context, IAuthenticationSchemeProvider schemes, string? returnUrl)
    {
        if (await schemes.GetSchemeAsync(AuthDefaults.GoogleScheme) is null)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Sign-in is not configured on this server.");
        }

        string target = ReturnUrl.Sanitize(returnUrl);
        if (context.User.Identity?.IsAuthenticated == true)
        {
            return Results.LocalRedirect(target);
        }

        return Results.Challenge(
            new AuthenticationProperties { RedirectUri = target },
            [AuthDefaults.GoogleScheme]);
    }

    private static NoContent IssueAntiforgeryToken(HttpContext context, IAntiforgery antiforgery)
    {
        // Sets the HttpOnly antiforgery cookie (cookie token) and returns the request token, which is handed to
        // the page in a cookie it can read: never in a response body (BREACH), and the client echoes it in a header.
        AntiforgeryTokenSet tokens = antiforgery.GetAndStoreTokens(context);
        context.Response.Cookies.Append(
            AuthDefaults.RequestTokenCookieName,
            tokens.RequestToken ?? string.Empty,
            new CookieOptions
            {
                HttpOnly = false, // JavaScript must read it to set the header.
                Secure = true,
                SameSite = SameSiteMode.Strict,
                Path = "/",
                IsEssential = true,
            });
        context.Response.Headers.CacheControl = "no-store";
        return TypedResults.NoContent();
    }

    private static async Task<IResult> Logout(HttpContext context, ILoggerFactory loggers)
    {
        Guid.TryParse(context.User.FindFirstValue(ClaimTypes.NameIdentifier), CultureInfo.InvariantCulture, out Guid userId);

        // Removes the server-side session, so a copy of the cookie stops working too.
        await context.SignOutAsync(AuthDefaults.CookieScheme);
        if (userId != Guid.Empty)
        {
            ILogger audit = loggers.CreateLogger(AuthLog.Category);
            AuthLog.SignedOut(audit, userId);
        }

        context.Response.Cookies.Delete(AuthDefaults.RequestTokenCookieName, new CookieOptions { Secure = true, Path = "/" });
        return TypedResults.NoContent();
    }

    private static async Task<IResult> GetMe(ClaimsPrincipal user, PolymniaDbContext db, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), CultureInfo.InvariantCulture, out Guid id))
        {
            return Results.Unauthorized();
        }

        MeResponse? me = await db.Users
            .AsNoTracking()
            .Where(u => u.Id == id)
            .Select(u => new MeResponse(u.Id, u.DisplayName, u.AvatarUrl, u.PreferredLanguage))
            .FirstOrDefaultAsync(cancellationToken);

        return me is null ? Results.Unauthorized() : Results.Ok(me);
    }
}

/// <summary>The signed-in user as the front end sees it.</summary>
internal sealed record MeResponse(Guid Id, string DisplayName, string? AvatarUrl, string? PreferredLanguage);

/// <summary>
/// Every state-changing request under <c>/api</c> must carry the antiforgery request token in the
/// <c>X-XSRF-TOKEN</c> header (cookie + header pattern). Nothing is read from the body.
/// </summary>
internal sealed class ApiAntiforgeryMiddleware(RequestDelegate next, IAntiforgery antiforgery)
{
    /// <summary>Machine-readable <c>code</c> of the 400 problem, so the front end can fetch a fresh token and retry.</summary>
    public const string ProblemCode = "antiforgery";

    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        if (RequiresToken(context.Request)
            && (!context.Request.Headers.ContainsKey(AuthDefaults.RequestTokenHeaderName)
                || !await antiforgery.IsRequestValidAsync(context)))
        {
            await Results.Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "Missing or invalid antiforgery token.",
                extensions: new Dictionary<string, object?> { ["code"] = ProblemCode }).ExecuteAsync(context);
            return;
        }

        await next(context);
    }

    private static bool RequiresToken(HttpRequest request) =>
        request.Path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase)
        && !HttpMethods.IsGet(request.Method)
        && !HttpMethods.IsHead(request.Method)
        && !HttpMethods.IsOptions(request.Method)
        && !HttpMethods.IsTrace(request.Method);
}
