namespace Polymnia.Api.Account;

/// <summary>
/// Write-only wrapper for the HTTP response body. Kestrel refuses synchronous writes, but <c>ZipArchive</c> still makes a
/// few when it closes an entry (the last compressed block and the data descriptor, a few hundred bytes). Those are
/// held here and sent by the next asynchronous write or flush, so the response never needs
/// <c>AllowSynchronousIO</c> (which would block a thread on a slow client). The bulk of the data goes through
/// <see cref="WriteAsync(ReadOnlyMemory{byte}, CancellationToken)"/> and is not buffered.
/// </summary>
internal sealed class SyncTolerantStream(Stream inner) : Stream
{
    private readonly MemoryStream _pending = new();

    public override bool CanRead => false;

    public override bool CanSeek => false;

    public override bool CanWrite => true;

    public override long Length => throw new NotSupportedException();

    public override long Position
    {
        get => throw new NotSupportedException();
        set => throw new NotSupportedException();
    }

    /// <summary>Bytes written synchronously and not yet sent. Small by construction; exposed for tests.</summary>
    internal long PendingBytes => _pending.Length;

    public override void Write(byte[] buffer, int offset, int count) => _pending.Write(buffer, offset, count);

    public override void Write(ReadOnlySpan<byte> buffer) => _pending.Write(buffer);

    public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
    {
        await SendPendingAsync(cancellationToken);
        await inner.WriteAsync(buffer, cancellationToken);
    }

    public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        WriteAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    public override void Flush()
    {
        // Nothing to do synchronously: the bytes leave with the next asynchronous write or flush.
    }

    public override async Task FlushAsync(CancellationToken cancellationToken)
    {
        await SendPendingAsync(cancellationToken);
        await inner.FlushAsync(cancellationToken);
    }

    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    private async ValueTask SendPendingAsync(CancellationToken cancellationToken)
    {
        if (_pending.Length == 0)
        {
            return;
        }

        ReadOnlyMemory<byte> bytes = _pending.GetBuffer().AsMemory(0, (int)_pending.Length);
        await inner.WriteAsync(bytes, cancellationToken);
        _pending.SetLength(0);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _pending.Dispose();
        }

        base.Dispose(disposing);
    }
}
