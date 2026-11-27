using System.Collections.Concurrent;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Polymnia.Api.Auth;

namespace Polymnia.Tests;

/// <summary>The claims the fake Google returns.</summary>
internal sealed class FakeGoogleIdentity
{
    public string Subject { get; set; } = "google-subject-1";

    public string? Name { get; set; } = "Ada Lovelace";

    public string? Picture { get; set; } = "https://lh3.googleusercontent.com/a/avatar";
}

internal sealed class FakeGoogleOptions : RemoteAuthenticationOptions
{
    public FakeGoogleIdentity Identity { get; set; } = new();
}

/// <summary>
/// Stands in for the OpenID Connect handler. The challenge goes straight to the callback, which reads the
/// claims from <see cref="FakeGoogleIdentity"/>. Everything after that is the real code: correlation cookie,
/// <c>OnTicketReceived</c> (user upsert), the server-side session.
/// </summary>
internal sealed class FakeGoogleHandler(IOptionsMonitor<FakeGoogleOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : RemoteAuthenticationHandler<FakeGoogleOptions>(options, logger, encoder)
{
    private static readonly ConcurrentDictionary<string, AuthenticationProperties> PendingStates = new();

    public static void Install(IServiceCollection services, FakeGoogleIdentity identity)
    {
        services.Configure<AuthenticationOptions>(options =>
            options.Schemes.Single(s => s.Name == AuthDefaults.GoogleScheme).HandlerType = typeof(FakeGoogleHandler));
        services.AddOptions<FakeGoogleOptions>(AuthDefaults.GoogleScheme).Configure(options =>
        {
            options.Identity = identity;
            options.CallbackPath = AuthDefaults.CallbackPath;
            options.SignInScheme = AuthDefaults.CookieScheme;
            options.CorrelationCookie.Name = AuthDefaults.CorrelationCookiePrefix;
            options.CorrelationCookie.Path = "/";
            options.CorrelationCookie.SecurePolicy = Microsoft.AspNetCore.Http.CookieSecurePolicy.Always;
            options.Events = new RemoteAuthenticationEvents { OnTicketReceived = SessionEvents.OnTicketReceived };
        });
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        GenerateCorrelationId(properties);
        string state = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(16));
        PendingStates[state] = properties;
        Response.Redirect($"{Options.CallbackPath}?state={state}");
        return Task.CompletedTask;
    }

    protected override Task<HandleRequestResult> HandleRemoteAuthenticateAsync()
    {
        string? state = Request.Query["state"];
        if (state is null || !PendingStates.TryRemove(state, out AuthenticationProperties? properties))
        {
            return Task.FromResult(HandleRequestResult.Fail("Unknown state."));
        }

        if (!ValidateCorrelationId(properties))
        {
            return Task.FromResult(HandleRequestResult.Fail("Correlation failed."));
        }

        FakeGoogleIdentity identity = Options.Identity;
        List<Claim> claims = [new("sub", identity.Subject)];
        if (identity.Name is not null)
        {
            claims.Add(new Claim("name", identity.Name));
        }

        if (identity.Picture is not null)
        {
            claims.Add(new Claim("picture", identity.Picture));
        }

        var ticket = new AuthenticationTicket(
            new ClaimsPrincipal(new ClaimsIdentity(claims, "Google")),
            properties,
            Scheme.Name);
        return Task.FromResult(HandleRequestResult.Success(ticket));
    }
}
