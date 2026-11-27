using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Polymnia.Infrastructure.Users;
using Polymnia.Core.Scores;
using Polymnia.Infrastructure.Scores;

namespace Polymnia.Infrastructure;

public static class InfrastructureServiceCollectionExtensions
{
    /// <summary>Name of the connection string entry (<c>ConnectionStrings:Polymnia</c>).</summary>
    public const string ConnectionStringName = "Polymnia";

    /// <summary>
    /// Registers <see cref="PolymniaDbContext"/> (pooled) on PostgreSQL.
    /// The connection string comes from configuration only (user-secrets or environment variables).
    /// </summary>
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        string? connectionString = configuration.GetConnectionString(ConnectionStringName);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            // Never include configuration values in the message.
            throw new InvalidOperationException(
                $"Connection string 'ConnectionStrings:{ConnectionStringName}' is not configured. " +
                "Set it with user-secrets or the 'ConnectionStrings__Polymnia' environment variable.");
        }

        services.AddDbContextPool<PolymniaDbContext>(options => options.UseNpgsql(
            connectionString,
            npgsql => npgsql.MigrationsAssembly(typeof(PolymniaDbContext).Assembly.FullName)));

        services.TryAddSingleton(TimeProvider.System);
        services.AddScoped<UserProvisioner>();
        services.AddSingleton<IScoreContentValidator, ScoreContentValidator>();
        services.AddScoped<ScoreStore>();

        return services;
    }
}
