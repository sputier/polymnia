using Testcontainers.PostgreSql;

namespace Polymnia.Tests;

/// <summary>
/// Starts a throw-away PostgreSQL container. When Docker is unavailable the tests that need it are
/// skipped with an explicit reason, except when <c>CI</c> or <c>POLYMNIA_REQUIRE_DOCKER</c> is set to
/// <c>true</c>: there, a missing Docker must fail the run, not hide the tests.
/// </summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private PostgreSqlContainer? _container;

    public string? UnavailableReason { get; private set; }

    public string ConnectionString =>
        _container?.GetConnectionString() ?? throw new InvalidOperationException("PostgreSQL container is not running.");

    public async ValueTask InitializeAsync()
    {
        PostgreSqlContainer container = new PostgreSqlBuilder("postgres:17-alpine").Build();
        try
        {
            await container.StartAsync(TestContext.Current.CancellationToken);
            _container = container;
        }
#pragma warning disable CA1031 // Any startup failure means "no usable Docker"; reported as a skip or rethrown when Docker is required.
        catch (Exception ex) when (ex is not OperationCanceledException)
#pragma warning restore CA1031
        {
            await container.DisposeAsync();
            if (IsTrue("CI") || IsTrue("POLYMNIA_REQUIRE_DOCKER"))
            {
                throw;
            }

            UnavailableReason = $"Docker is not available, PostgreSQL integration tests skipped ({ex.GetType().Name}: {ex.Message}).";
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_container is not null)
        {
            await _container.DisposeAsync();
        }
    }

    public void SkipIfUnavailable() => Assert.SkipUnless(UnavailableReason is null, UnavailableReason ?? string.Empty);

    private static bool IsTrue(string name) =>
        string.Equals(Environment.GetEnvironmentVariable(name), "true", StringComparison.OrdinalIgnoreCase);
}
