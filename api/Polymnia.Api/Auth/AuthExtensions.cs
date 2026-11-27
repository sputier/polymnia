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
                LoadKeyCertificate(keyCertificatePath, ReadCertificatePassword(configuration)));
        }

        // The OpenID Connect handler logs Google's error_description verbatim (attacker-controlled through
        // /api/auth/callback?error_description=...). Our own AuthSignInFailed event records the failure type instead.
        services.AddLogging(logging => logging.AddFilter(
            "Microsoft.AspNetCore.Authentication.OpenIdConnect.OpenIdConnectHandler", LogLevel.None));

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
                options.Events.OnSignedIn = SessionEvents.OnSignedIn;
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
                    if (context.Properties.Items.ContainsKey(AuthDefaults.ReauthProperty))
                    {
                        // Re-authentication (account deletion): Google asks the person to pick their account again.
                        context.ProtocolMessage.Prompt = "select_account";
                        // Harmless if Google ignores it: ask for a fresh authentication.
                        context.ProtocolMessage.MaxAge = "0";
                    }

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

    /// <summary>
    /// The password of the key certificate: read from <c>DataProtection:CertificatePasswordFile</c> when set (a Docker
    /// secret keeps it out of the environment), otherwise <c>DataProtection:CertificatePassword</c>.
    /// The file content is the password; trailing line breaks are not part of it.
    /// </summary>
    internal static string? ReadCertificatePassword(IConfiguration configuration)
    {
        string? file = configuration["DataProtection:CertificatePasswordFile"];
        if (string.IsNullOrWhiteSpace(file))
        {
            return configuration["DataProtection:CertificatePassword"];
        }

        try
        {
            return File.ReadAllText(file).TrimEnd('\r', '\n');
        }
        catch (IOException ex)
        {
            throw new InvalidOperationException("DataProtection:CertificatePasswordFile could not be read.", ex);
        }
        catch (UnauthorizedAccessException ex)
        {
            throw new InvalidOperationException("DataProtection:CertificatePasswordFile could not be read (permissions).", ex);
        }
    }

    private static X509Certificate2 LoadKeyCertificate(string path, string? password)
    {
        X509Certificate2 certificate;
        try
        {
            certificate = X509CertificateLoader.LoadPkcs12FromFile(path, password);
        }
        catch (Exception ex) when (ex is CryptographicException or IOException)
        {
            // The configured path and password are not in this message (the inner exception may name the file).
            throw new InvalidOperationException(
                "The Data Protection certificate could not be loaded: check DataProtection:CertificatePath and DataProtection:CertificatePassword.",
                ex);
        }

        // A public-only file would encrypt the keys now and make them unreadable after a restart.
        DateTime now = DateTime.UtcNow;
        if (!certificate.HasPrivateKey || now < certificate.NotBefore.ToUniversalTime() || now > certificate.NotAfter.ToUniversalTime())
        {
            certificate.Dispose();
            throw new InvalidOperationException(
                "The Data Protection certificate must contain a private key and be within its validity period.");
        }

        return certificate;
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
        var throttle = new LogThrottle(TimeSpan.FromSeconds(10));
        limiter.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
            context.Request.Path.StartsWithSegments("/api/auth", StringComparison.OrdinalIgnoreCase)
            && ClientKey(context.Connection.RemoteIpAddress) is { } key
                ? RateLimitPartition.GetFixedWindowLimiter(
                    key,
                    _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = settings.PermitLimit,
                        Window = settings.Window,
                        QueueLimit = 0,
                        AutoReplenishment = true,
                    })
                : RateLimitPartition.GetNoLimiter("not-limited"));
        limiter.OnRejected = async (context, cancellationToken) =>
        {
            if (throttle.ShouldLog(out int suppressed))
            {
                AuthLog.RateLimited(logger, suppressed + 1);
            }

            HttpContext http = context.HttpContext;
            if (http.Request.Path.StartsWithSegments(AuthDefaults.CallbackPath, StringComparison.OrdinalIgnoreCase))
            {
                // A person coming back from Google gets the sign-in page, not a bare error.
                http.Response.Redirect("/?signin=failed");
                return;
            }

            if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out TimeSpan retryAfter))
            {
                http.Response.Headers.RetryAfter = Math.Ceiling(retryAfter.TotalSeconds).ToString(CultureInfo.InvariantCulture);
            }

            await Results.Problem(statusCode: StatusCodes.Status429TooManyRequests, title: "Too many requests.")
                .ExecuteAsync(http);
        };
    }

    /// <summary>
    /// Rate limit partition of a client: the IPv4 address, or the /64 prefix for IPv6 (a single subscriber owns a whole
    /// /64, so per-address keys would be free to rotate). <c>null</c> (no address, for example a Unix socket) means
    /// "not limited here". Behind a reverse proxy, forwarded headers must be enabled or all clients share the proxy's key.
    /// </summary>
    internal static string? ClientKey(System.Net.IPAddress? address)
    {
        if (address is null)
        {
            return null;
        }

        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        if (address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetworkV6)
        {
            return address.ToString();
        }

        byte[] bytes = address.GetAddressBytes();
        Array.Clear(bytes, 8, 8);
        return new System.Net.IPAddress(bytes) + "/64";
    }

    /// <summary>Lets a log line through at most once per interval, counting what was held back.</summary>
    private sealed class LogThrottle(TimeSpan interval)
    {
        private readonly Lock _gate = new();
        private DateTime _next = DateTime.MinValue;
        private int _suppressed;

        public bool ShouldLog(out int suppressed)
        {
            lock (_gate)
            {
                if (DateTime.UtcNow < _next)
                {
                    _suppressed++;
                    suppressed = 0;
                    return false;
                }

                _next = DateTime.UtcNow + interval;
                suppressed = _suppressed;
                _suppressed = 0;
                return true;
            }
        }
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

    private static async Task<IResult> Login(HttpContext context, IAuthenticationSchemeProvider schemes, string? returnUrl, bool? reauth)
    {
        if (await schemes.GetSchemeAsync(AuthDefaults.GoogleScheme) is null)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Sign-in is not configured on this server.");
        }

        string target = ReturnUrl.Sanitize(returnUrl);
        if (context.User.Identity?.IsAuthenticated == true && reauth != true)
        {
            return Results.LocalRedirect(target);
        }

        var properties = new AuthenticationProperties { RedirectUri = target };
        if (reauth == true)
        {
            // A fresh sign-in replaces the session (and its auth_time); the old session row dies with its expiry.
            // The value is the user who must come back: it travels in the protected OIDC state, and the callback
            // refuses a different Google account (otherwise the person would delete a new, empty account).
            properties.Items[AuthDefaults.ReauthProperty] =
                context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? string.Empty;
        }

        return Results.Challenge(properties, [AuthDefaults.GoogleScheme]);
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
