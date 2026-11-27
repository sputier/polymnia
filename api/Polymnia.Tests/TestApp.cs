using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Polymnia.Infrastructure;

namespace Polymnia.Tests;

/// <summary>
/// Test host. Uses a throw-away web root and, unless told otherwise, a connection string that points
/// nowhere: nothing in these tests needs a database unless it passes a real connection string.
/// </summary>
internal sealed class TestApp : WebApplicationFactory<Program>
{
    public const string IndexHtml = "<!doctype html><html><head><title>Polymnia</title></head><body><div id=\"root\"></div></body></html>";
    public const string AssetBody = "console.log('polymnia');";
    public const string UnreachableConnectionString = "Host=127.0.0.1;Port=1;Database=polymnia_unused;Username=u;Password=p;Timeout=1";

    public const string PublicBaseUrl = "https://polymnia.example";

    /// <summary>The identity the fake Google returns at the next sign-in.</summary>
    public FakeGoogleIdentity Google { get; } = new();

    private readonly string _environment;
    private readonly string _connectionString;
    private readonly Dictionary<string, string?> _settings;
    private readonly string _webRoot;
    private readonly bool _configureAuth;
    private readonly bool _fakeGoogle;

    public TestApp(
        string environment = "Production",
        string? connectionString = null,
        Dictionary<string, string?>? settings = null,
        bool configureAuth = true,
        bool fakeGoogle = true)
    {
        _environment = environment;
        _connectionString = connectionString ?? UnreachableConnectionString;
        _settings = settings ?? [];
        _configureAuth = configureAuth;
        _fakeGoogle = fakeGoogle;
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
        if (_configureAuth)
        {
            // Dummy values: no call to Google is ever made.
            builder.UseSetting("Auth:PublicBaseUrl", PublicBaseUrl);
            builder.UseSetting("Auth:Google:ClientId", "test-client-id.apps.googleusercontent.com");
            builder.UseSetting("Auth:Google:ClientSecret", "test-client-secret");
        }

        builder.ConfigureTestServices(services =>
        {
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
                // Real OpenID Connect handler, without discovery over the network.
                services.PostConfigure<OpenIdConnectOptions>("Google", options =>
                {
                    var configuration = new OpenIdConnectConfiguration
                    {
                        Issuer = "https://accounts.example",
                        AuthorizationEndpoint = "https://accounts.example/authorize",
                        TokenEndpoint = "https://accounts.example/token",
                    };
                    options.Configuration = configuration;
                    options.ConfigurationManager = new StaticConfigurationManager<OpenIdConnectConfiguration>(configuration);
                });
            }
        });

        foreach ((string key, string? value) in _settings)
        {
            builder.UseSetting(key, value);
        }
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
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
