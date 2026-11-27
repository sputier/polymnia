using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace Polymnia.Tests;

/// <summary>Records every log entry of a test host (category, event id, level, rendered message).</summary>
internal sealed class LogCapture : ILoggerProvider
{
    private readonly ConcurrentQueue<LogEntry> _entries = new();

    public IReadOnlyList<LogEntry> Entries => [.. _entries];

    public void Clear() => _entries.Clear();

    public ILogger CreateLogger(string categoryName) => new CaptureLogger(categoryName, _entries);

    public void Dispose()
    {
    }

    internal sealed record LogEntry(string Category, EventId EventId, LogLevel Level, string Message);

    private sealed class CaptureLogger(string category, ConcurrentQueue<LogEntry> entries) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            ArgumentNullException.ThrowIfNull(formatter);
            entries.Enqueue(new LogEntry(category, eventId, logLevel, formatter(state, exception)));
        }
    }
}
