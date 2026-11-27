using Polymnia.Api.Account;
using Polymnia.Api.Auth;
using Polymnia.Api.Contact;
using Polymnia.Api.Hosting;
using Polymnia.Api.Legal;
using Polymnia.Api.Scores;
using Polymnia.Api.Sharing;
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

// The share token travels in a header, never in the path. Should a stale client still put one in a path
// (/api/shared/<token>), the framework categories that write request paths stay at Warning whatever the configuration.
foreach (string category in new[]
{
    "Microsoft.AspNetCore.Hosting.Diagnostics",
    "Microsoft.AspNetCore.Routing",
    "Microsoft.AspNetCore.StaticFiles",
})
{
    builder.Logging.AddFilter(category, LogLevel.Warning);
}

ConnectionStringGuard.Validate(builder.Configuration, builder.Environment);
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddPolymniaHosting(builder.Configuration, builder.Environment);
builder.Services.AddPolymniaAuth(builder.Configuration, builder.Environment);
builder.Services.AddScoreApi(builder.Configuration, builder.Environment);
builder.Services.AddShareApi(builder.Configuration);
builder.Services.AddLegal(builder.Configuration);
builder.Services.AddContact(builder.Configuration);
builder.Services.AddAccount();

WebApplication app = builder.Build();

if (migrateOnly)
{
    // Apply the EF Core migrations and exit without starting the web server.
    return await ContainerCommands.MigrateAsync(app.Services);
}

app.UsePolymniaPipeline();
app.UsePolymniaAuth();
app.UseScoreApi();
app.MapPolymniaEndpoints();
app.MapAuthEndpoints();
app.MapScoreApi();
app.MapShareEndpoints();
app.MapAccountEndpoints();
app.MapLegalEndpoints();
app.MapContactEndpoints();
app.MapSpaFallback();

await app.RunAsync();
return 0;

/// <summary>Entry point marker, required by <c>WebApplicationFactory</c> in the test project.</summary>
public partial class Program;
