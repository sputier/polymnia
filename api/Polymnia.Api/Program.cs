using Polymnia.Api.Hosting;
using Polymnia.Api.Spa;
using Polymnia.Infrastructure;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel(options =>
{
    // Do not advertise the server software.
    options.AddServerHeader = false;
    // Small default; endpoints that need more must opt in explicitly.
    options.Limits.MaxRequestBodySize = 1024 * 1024;
});

builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddPolymniaHosting(builder.Configuration, builder.Environment);

WebApplication app = builder.Build();

app.UsePolymniaPipeline();
app.MapPolymniaEndpoints();
app.MapSpaFallback();

await app.RunAsync();

/// <summary>Entry point marker, required by <c>WebApplicationFactory</c> in the test project.</summary>
public partial class Program;
