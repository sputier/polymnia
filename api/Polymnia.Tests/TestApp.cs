using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Polymnia.Infrastructure;

namespace Polymnia.Tests;

/// <summary>
/// TestServer has no client address. Gives every request one (loopback, or the one in <c>X-Test-Client-Ip</c>),
/// as Kestrel or the forwarded-headers middleware would.
/// </summary>
internal sealed class ClientIpStartupFilter : Microsoft.AspNetCore.Hosting.IStartupFilter
{
    public const string Header = "X-Test-Client-Ip";

    public Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> Configure(Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> next)
    {
        ArgumentNullException.ThrowIfNull(next);
        return app =>
        {
            app.Use(async (context, nextMiddleware) =>
            {
                context.Connection.RemoteIpAddress = System.Net.IPAddress.TryParse(context.Request.Headers[Header], out System.Net.IPAddress? ip)
                    ? ip
                    : System.Net.IPAddress.Loopback;
                await nextMiddleware();
            });
            next(app);
        };
    }
}

/// <summary>
/// Test host. Uses a throw-away web root and, unless told otherwise, a connection string that points
/// nowhere: nothing in these tests needs a database unless it passes a real connection string.
/// </summary>
internal sealed class TestApp : WebApplicationFactory<Program>
{
    public const string IndexHtml = "<!doctype html><html><head><title>Polymnia</title></head><body><div id=\"root\"></div></body></html>";
    public const string AssetBody = "console.log('polymnia');";
    public const string UnreachableConnectionString = "Host=127.0.0.1;Port=1;Database=polymnia_unused;Username=u;Password=unused-test-password-0123456789;Timeout=1";

    public const string PublicBaseUrl = "https://polymnia.example";

    /// <summary>The identity the fake Google returns at the next sign-in.</summary>
    public FakeGoogleIdentity Google { get; } = new();

    /// <summary>Stand-in for Google when the real OpenID Connect handler is used (<c>fakeGoogle: false</c>).</summary>
    public OidcTestServer Oidc { get; } = new();

    /// <summary>Every log entry of the host.</summary>
    internal LogCapture Logs { get; } = new();

    private readonly string _environment;
    private readonly string _connectionString;
    private readonly Dictionary<string, string?> _settings;
    private readonly string _webRoot;
    private readonly bool _configureAuth;
    private readonly bool _fakeGoogle;
    private readonly Action<IServiceCollection>? _configureServices;

    public TestApp(
        string environment = "Production",
        string? connectionString = null,
        Dictionary<string, string?>? settings = null,
        bool configureAuth = true,
        bool fakeGoogle = true,
        Action<IServiceCollection>? configureServices = null)
    {
        _environment = environment;
        _connectionString = connectionString ?? UnreachableConnectionString;
        _settings = settings ?? [];
        _configureAuth = configureAuth;
        _fakeGoogle = fakeGoogle;
        _configureServices = configureServices;
        _webRoot = Path.Combine(Path.GetTempPath(), "polymnia-tests-" + Guid.NewGuid().ToString("N"));

        Directory.CreateDirectory(Path.Combine(_webRoot, "assets"));
        File.WriteAllText(Path.Combine(_webRoot, "index.html"), IndexHtml);
        File.WriteAllText(Path.Combine(_webRoot, "assets", "index-4f9a1c2b.js"), AssetBody);
        File.WriteAllText(Path.Combine(_webRoot, "favicon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    }

    /// <summary>A client whose base address is an HTTPS, non-localhost host (HSTS ignores localhost).</summary>
    public HttpClient CreateSecureClient() => CreateClient(new WebApplicationFactoryClientOptions
    {
        BaseAddress = new Uri("https://polymnia.example"),
        AllowAutoRedirect = false,
    });

    /// <summary>Applies the migrations (the database must be the test container).</summary>
    public async Task MigrateAsync()
    {
        using IServiceScope scope = Services.CreateScope();
        PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
        await db.Database.MigrateAsync(TestContext.Current.CancellationToken);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.UseEnvironment(_environment);
        builder.UseWebRoot(_webRoot);
        builder.UseSetting("ConnectionStrings:Polymnia", _connectionString);
        builder.UseSetting("https_port", "443");
        if (_environment != "Development")
        {
            // Required outside Development: a real host list, never "*".
            builder.UseSetting("AllowedHosts", "polymnia.example;localhost");

            // Required outside Development: who runs the instance (privacy page, docs/privacy.md).
            builder.UseSetting("Legal:OperatorName", "Example Operator");
            builder.UseSetting("Legal:Contact", "privacy@polymnia.example");
            builder.UseSetting("Legal:HostingProvider", "Example Hosting");
        }

        if (_configureAuth)
        {
            if (_environment != "Development")
            {
                // Required outside Development: the Data Protection keys are encrypted with a certificate.
                builder.UseSetting("DataProtection:CertificatePath", TestCertificate.Path);
                builder.UseSetting("DataProtection:CertificatePassword", TestCertificate.Password);
            }

            // Dummy values: no call to Google is ever made.
            builder.UseSetting("Auth:PublicBaseUrl", PublicBaseUrl);
            builder.UseSetting("Auth:Google:ClientId", "test-client-id.apps.googleusercontent.com");
            builder.UseSetting("Auth:Google:ClientSecret", "test-client-secret");
        }

        builder.ConfigureTestServices(services =>
        {
            services.AddTransient<Microsoft.AspNetCore.Hosting.IStartupFilter, ClientIpStartupFilter>();
            _configureServices?.Invoke(services);
            if (!_configureAuth)
            {
                return;
            }

            if (_fakeGoogle)
            {
                FakeGoogleHandler.Install(services, Google);
            }
            else
            {
                // Real OpenID Connect handler. No discovery over the network: static configuration and keys,
                // and a token endpoint served by OidcTestServer.
                services.PostConfigure<OpenIdConnectOptions>("Google", options =>
                {
                    OpenIdConnectConfiguration configuration = Oidc.CreateConfiguration();
                    options.Configuration = configuration;
                    options.ConfigurationManager = new StaticConfigurationManager<OpenIdConnectConfiguration>(configuration);
                    options.Backchannel = new HttpClient(Oidc.Handler);
                });
            }
        });
        builder.ConfigureLogging(logging => logging.AddProvider(Logs));
        builder.UseSetting("Logging:LogLevel:Microsoft.EntityFrameworkCore.Database.Command", "Information");

        // Tests sign in hundreds of new users from one address: the registration brakes are off unless a test sets them.
        builder.UseSetting("Auth:Registration:MaxNewAccountsPerDay", "1000000");
        builder.UseSetting("Auth:Registration:MaxNewAccountsPerAddressPerDay", "1000000");

        foreach ((string key, string? value) in _settings)
        {
            builder.UseSetting(key, value);
        }
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing)
        {
            Oidc.Dispose();
        }

        if (disposing && Directory.Exists(_webRoot))
        {
            try
            {
                Directory.Delete(_webRoot, recursive: true);
            }
            catch (IOException)
            {
                // A file watcher may still hold the folder on Windows; it is a temp folder.
            }
        }
    }
}
