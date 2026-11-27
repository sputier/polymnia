using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

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

    private readonly string _environment;
    private readonly string _connectionString;
    private readonly Dictionary<string, string?> _settings;
    private readonly string _webRoot;

    public TestApp(
        string environment = "Production",
        string? connectionString = null,
        Dictionary<string, string?>? settings = null)
    {
        _environment = environment;
        _connectionString = connectionString ?? UnreachableConnectionString;
        _settings = settings ?? [];
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

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.UseEnvironment(_environment);
        builder.UseWebRoot(_webRoot);
        builder.UseSetting("ConnectionStrings:Polymnia", _connectionString);
        builder.UseSetting("https_port", "443");
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
