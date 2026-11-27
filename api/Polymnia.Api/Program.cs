using Polymnia.Api.Auth;
using Polymnia.Api.Hosting;
using Polymnia.Api.Spa;
using Polymnia.Infrastructure;

// Container one-shot switches (see ContainerCommands). The health probe needs no host at all.
if (ContainerCommands.HasSwitch(args, ContainerCommands.HealthCheckSwitch))
{
    return await ContainerCommands.HealthCheckAsync(Environment.GetEnvironmentVariable);
}

bool migrateOnly = ContainerCommands.HasSwitch(args, ContainerCommands.MigrateSwitch);
WebApplicationBuilder builder = WebApplication.CreateBuilder(ContainerCommands.StripSwitches(args));

builder.WebHost.ConfigureKestrel(options =>
{
    // Do not advertise the server software.
    options.AddServerHeader = false;
    // Small default; endpoints that need more must opt in explicitly.
    options.Limits.MaxRequestBodySize = 1024 * 1024;
});

builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddPolymniaHosting(builder.Configuration, builder.Environment);
builder.Services.AddPolymniaAuth(builder.Configuration, builder.Environment);

WebApplication app = builder.Build();

if (migrateOnly)
{
    // Apply the EF Core migrations and exit without starting the web server.
    return await ContainerCommands.MigrateAsync(app.Services);
}

app.UsePolymniaPipeline();
app.UsePolymniaAuth();
app.MapPolymniaEndpoints();
app.MapAuthEndpoints();
app.MapSpaFallback();

await app.RunAsync();
return 0;

/// <summary>Entry point marker, required by <c>WebApplicationFactory</c> in the test project.</summary>
public partial class Program;
