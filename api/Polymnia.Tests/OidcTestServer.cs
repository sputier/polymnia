using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Polymnia.Tests;

/// <summary>
/// A stand-in for Google: a test RSA key published as a static key set, and a token endpoint that answers
/// with whatever ID token the test prepared. The application's real OpenID Connect handler talks to it.
/// </summary>
internal sealed class OidcTestServer : IDisposable
{
    public const string Issuer = "https://accounts.example";
    public const string ClientId = "test-client-id.apps.googleusercontent.com";

    private readonly RSA _key = RSA.Create(2048);
    private readonly RSA _otherKey = RSA.Create(2048);

    public OidcTestServer()
    {
        SigningKey = new RsaSecurityKey(_key) { KeyId = "test-key-1" };
        Handler = new TokenEndpoint(this);
    }

    public RsaSecurityKey SigningKey { get; }

    public HttpMessageHandler Handler { get; }

    /// <summary>The ID token the token endpoint returns next.</summary>
    public string? NextIdToken { get; set; }

    /// <summary>Form fields of the last request the application sent to the token endpoint.</summary>
    public Dictionary<string, string> LastTokenRequest { get; private set; } = [];

    public int TokenRequests { get; private set; }

    public OpenIdConnectConfiguration CreateConfiguration()
    {
        var configuration = new OpenIdConnectConfiguration
        {
            Issuer = Issuer,
            AuthorizationEndpoint = Issuer + "/authorize",
            TokenEndpoint = Issuer + "/token",
        };
        configuration.SigningKeys.Add(SigningKey);
        return configuration;
    }

    /// <summary>Builds a signed ID token. Pass different values to make it invalid in one precise way.</summary>
    public string CreateIdToken(
        string nonce,
        string subject = "google-oidc-subject",
        string name = "Grace Hopper",
        string audience = ClientId,
        string issuer = Issuer,
        bool expired = false,
        bool signedByUnknownKey = false)
    {
        DateTime now = DateTime.UtcNow;
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            IssuedAt = expired ? now.AddHours(-2) : now.AddMinutes(-1),
            NotBefore = expired ? now.AddHours(-2) : now.AddMinutes(-1),
            Expires = expired ? now.AddHours(-1) : now.AddHours(1),
            SigningCredentials = new SigningCredentials(
                signedByUnknownKey ? new RsaSecurityKey(_otherKey) { KeyId = "test-key-1" } : SigningKey,
                SecurityAlgorithms.RsaSha256),
            Claims = new Dictionary<string, object>
            {
                ["sub"] = subject,
                ["name"] = name,
                ["picture"] = "https://lh3.googleusercontent.com/a/oidc-avatar",
                ["nonce"] = nonce,
            },
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }

    public void Dispose()
    {
        _key.Dispose();
        _otherKey.Dispose();
    }

    private sealed class TokenEndpoint(OidcTestServer server) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.Method != HttpMethod.Post || request.RequestUri?.AbsoluteUri != Issuer + "/token")
            {
                return new HttpResponseMessage(HttpStatusCode.NotFound);
            }

            string body = await request.Content!.ReadAsStringAsync(cancellationToken);
            server.TokenRequests++;
            server.LastTokenRequest = body.Split('&', StringSplitOptions.RemoveEmptyEntries)
                .Select(p => p.Split('=', 2))
                .ToDictionary(p => Uri.UnescapeDataString(p[0]), p => Uri.UnescapeDataString((p.ElementAtOrDefault(1) ?? string.Empty).Replace('+', ' ')));

            if (server.NextIdToken is null)
            {
                return new HttpResponseMessage(HttpStatusCode.BadRequest)
                {
                    Content = new StringContent("{\"error\":\"invalid_grant\"}", Encoding.UTF8, "application/json"),
                };
            }

            string json = $"{{\"access_token\":\"test-access-token\",\"token_type\":\"Bearer\",\"expires_in\":3600,\"id_token\":\"{server.NextIdToken}\"}}";
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        }
    }
}

/// <summary>A throw-away self-signed PKCS#12 certificate, used to encrypt the Data Protection keys in tests.</summary>
internal static class TestCertificate
{
    public const string Password = "test-only-password";

    private static readonly Lazy<string> LazyPath = new(Create);

    public static string Path => LazyPath.Value;

    private static string Create()
    {
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest("CN=polymnia-test", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using X509Certificate2 certificate = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(30));
        string path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "polymnia-test-" + Guid.NewGuid().ToString("N") + ".pfx");
        File.WriteAllBytes(path, certificate.Export(X509ContentType.Pfx, Password));
        return path;
    }
}
