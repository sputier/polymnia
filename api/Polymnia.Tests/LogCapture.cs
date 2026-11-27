using System.Collections.Concurrent;
using System.Text;
using Microsoft.Extensions.Logging;

namespace Polymnia.Tests;

/// <summary>
/// Records every log entry of a test host (category, event id, level, rendered message and the scopes open at that
/// moment, rendered), as a provider that includes scopes would.
/// </summary>
internal sealed class LogCapture : ILoggerProvider, ISupportExternalScope
{
    private readonly ConcurrentQueue<LogEntry> _entries = new();
    private IExternalScopeProvider _scopes = new LoggerExternalScopeProvider();

    public IReadOnlyList<LogEntry> Entries => [.. _entries];

    public void Clear() => _entries.Clear();

    public void SetScopeProvider(IExternalScopeProvider scopeProvider) => _scopes = scopeProvider;

    public ILogger CreateLogger(string categoryName) => new CaptureLogger(categoryName, _entries, () => _scopes);

    public void Dispose()
    {
    }

    internal sealed record LogEntry(string Category, EventId EventId, LogLevel Level, string Message, string Scopes = "");

    private sealed class CaptureLogger(string category, ConcurrentQueue<LogEntry> entries, Func<IExternalScopeProvider> scopes) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => scopes().Push(state);

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            ArgumentNullException.ThrowIfNull(formatter);
            StringBuilder rendered = new();
            scopes().ForEachScope(
                static (scope, builder) =>
                {
                    builder.Append(scope).Append(' ');
                    if (scope is IEnumerable<KeyValuePair<string, object?>> pairs)
                    {
                        foreach (KeyValuePair<string, object?> pair in pairs)
                        {
                            builder.Append(pair.Key).Append('=').Append(pair.Value).Append(' ');
                        }
                    }
                },
                rendered);
            entries.Enqueue(new LogEntry(category, eventId, logLevel, formatter(state, exception), rendered.ToString()));
        }
    }
}
