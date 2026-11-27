using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Polymnia.Infrastructure;

namespace Polymnia.Api.Hosting;

/// <summary>
/// One-shot command-line switches used by the container image and docker-compose:
/// <c>--migrate</c> applies the EF Core migrations and exits, <c>--healthcheck</c> probes the local
/// liveness endpoint and exits (the chiseled runtime image has no shell, curl or wget).
/// </summary>
internal static partial class ContainerCommands
{
    public const string MigrateSwitch = "--migrate";
    public const string HealthCheckSwitch = "--healthcheck";

    private const string DefaultPort = "8080";
    private static readonly TimeSpan HealthCheckTimeout = TimeSpan.FromSeconds(3);

    public static bool HasSwitch(string[] args, string name)
    {
        ArgumentNullException.ThrowIfNull(args);
        return args.Contains(name, StringComparer.Ordinal);
    }

    /// <summary>Removes the container switches so they are not parsed as configuration keys.</summary>
    public static string[] StripSwitches(string[] args)
    {
        ArgumentNullException.ThrowIfNull(args);
        return [.. args.Where(static a => a is not MigrateSwitch and not HealthCheckSwitch)];
    }

    /// <summary>Applies pending migrations. Returns the process exit code (0 on success).</summary>
    public static async Task<int> MigrateAsync(IServiceProvider services, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(services);

        ILogger logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("Polymnia.Migrate");
        try
        {
            await using AsyncServiceScope scope = services.CreateAsyncScope();
            PolymniaDbContext db = scope.ServiceProvider.GetRequiredService<PolymniaDbContext>();
            int pending = (await db.Database.GetPendingMigrationsAsync(cancellationToken)).Count();
            LogMigrating(logger, pending);
            await db.Database.MigrateAsync(cancellationToken);
            LogMigrated(logger);
            return 0;
        }
#pragma warning disable CA1031 // A one-shot command reports any failure through its exit code.
        catch (Exception ex)
#pragma warning restore CA1031
        {
            // Npgsql and EF Core exceptions never contain the password, and the operator needs the cause.
            LogMigrationFailed(logger, ex);
            return 1;
        }
    }

    /// <summary>
    /// Calls <c>GET /api/health</c> on the local listener. The Host header is the first concrete
    /// <c>AllowedHosts</c> entry, otherwise host filtering would reject the probe. Returns 0 when healthy.
    /// Only environment variables are read (<c>AllowedHosts</c>, <c>ASPNETCORE_HTTP_PORTS</c>): set them there.
    /// </summary>
    public static async Task<int> HealthCheckAsync(
        Func<string, string?> getEnvironmentVariable,
        HttpMessageHandler? handler = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(getEnvironmentVariable);

        string port = FirstPort(getEnvironmentVariable("ASPNETCORE_HTTP_PORTS"));
        string host = FirstConcreteHost(getEnvironmentVariable("AllowedHosts")) ?? "localhost";

        using HttpClient client = handler is null ? new HttpClient() : new HttpClient(handler, disposeHandler: false);
        client.Timeout = HealthCheckTimeout;
        using HttpRequestMessage request = new(HttpMethod.Get, new Uri(string.Create(CultureInfo.InvariantCulture, $"http://127.0.0.1:{port}/api/health")));
        request.Headers.Host = host;
        try
        {
            using HttpResponseMessage response = await client.SendAsync(request, cancellationToken);
            return response.IsSuccessStatusCode ? 0 : 1;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or FormatException or InvalidOperationException)
        {
            return 1;
        }
    }

    internal static string FirstPort(string? httpPorts)
    {
        string? first = httpPorts?.Split([';', ','], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault();
        return int.TryParse(first, NumberStyles.None, CultureInfo.InvariantCulture, out int port) && port is > 0 and <= 65535
            ? port.ToString(CultureInfo.InvariantCulture)
            : DefaultPort;
    }

    internal static string? FirstConcreteHost(string? allowedHosts)
    {
        if (string.IsNullOrWhiteSpace(allowedHosts))
        {
            return null;
        }

        foreach (string entry in allowedHosts.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!entry.Contains('*', StringComparison.Ordinal)
                && Uri.TryCreate("http://" + entry, UriKind.Absolute, out Uri? uri)
                && uri.Authority.Equals(entry, StringComparison.OrdinalIgnoreCase)
                && uri.HostNameType is UriHostNameType.Dns)
            {
                return entry;
            }
        }

        return null;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Applying {Pending} pending migration(s).")]
    private static partial void LogMigrating(ILogger logger, int pending);

    [LoggerMessage(Level = LogLevel.Information, Message = "Database is up to date.")]
    private static partial void LogMigrated(ILogger logger);

    [LoggerMessage(Level = LogLevel.Error, Message = "Migration failed.")]
    private static partial void LogMigrationFailed(ILogger logger, Exception exception);
}
