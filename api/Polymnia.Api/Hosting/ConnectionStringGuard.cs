using Npgsql;
using Polymnia.Infrastructure;

namespace Polymnia.Api.Hosting;

/// <summary>
/// Outside Development the database password must not be the placeholder of <c>.env.example</c> and must be at
/// least <see cref="MinimumPasswordLength"/> characters: the application (and so the one-shot <c>migrate</c> service
/// that starts before it) refuses to start otherwise. Messages never contain the connection string.
/// </summary>
internal static class ConnectionStringGuard
{
    public const int MinimumPasswordLength = 16;

    /// <summary>The value shipped in <c>.env.example</c>; anything that looks like a "change me" marker is refused too.</summary>
    public const string Placeholder = "change-me-locally";

    public static void Validate(IConfiguration configuration, IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(environment);

        if (environment.IsDevelopment())
        {
            return;
        }

        string? connectionString = configuration.GetConnectionString(InfrastructureServiceCollectionExtensions.ConnectionStringName);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return; // AddInfrastructure reports the missing setting.
        }

        string? password;
        try
        {
            password = new NpgsqlConnectionStringBuilder(connectionString).Password;
        }
        catch (ArgumentException)
        {
            throw new InvalidOperationException("ConnectionStrings:Polymnia is not a valid PostgreSQL connection string.");
        }

        if (string.IsNullOrEmpty(password))
        {
            // Npgsql also reads PGPASSFILE (not inspected here) and PGPASSWORD (checked like a password in the string).
            if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("PGPASSFILE")))
            {
                return;
            }

            password = Environment.GetEnvironmentVariable("PGPASSWORD");
        }

        if (string.IsNullOrEmpty(password)
            || password.Contains("change-me", StringComparison.OrdinalIgnoreCase)
            || password.Contains("replace-with", StringComparison.OrdinalIgnoreCase)
            || password.Length < MinimumPasswordLength)
        {
            throw new InvalidOperationException(
                $"The database password must be set, must not be the placeholder of .env.example and must have at least {MinimumPasswordLength} characters " +
                "(POSTGRES_PASSWORD, outside Development). Generate one with `openssl rand -hex 16`.");
        }
    }
}
