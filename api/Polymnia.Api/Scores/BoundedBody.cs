using System.Buffers;
using Microsoft.AspNetCore.Http.Features;
using Polymnia.Core.Scores;

namespace Polymnia.Api.Scores;

/// <summary>Reads a request body without ever buffering more than the limit.</summary>
internal static class BoundedBody
{
    private static readonly TimeSpan ReadTimeout = TimeSpan.FromSeconds(15);

    /// <summary>
    /// Returns the body, or <c>null</c> when it is larger than <see cref="ScoreLimits.MaxContentBytes"/> (answer 413).
    /// The limit is checked on <c>Content-Length</c> first, then while reading (chunked bodies have no length).
    /// </summary>
    public static async Task<ReadOnlyMemory<byte>?> ReadAsync(HttpContext context, CancellationToken ct, int limit = ScoreLimits.MaxContentBytes)
    {
        if (context.Request.ContentLength > limit)
        {
            return null;
        }

        // Kestrel's global limit is small on purpose; this endpoint opts in to its own.
        IHttpMaxRequestBodySizeFeature? feature = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (feature is { IsReadOnly: false })
        {
            feature.MaxRequestBodySize = limit;
        }

        // A client that trickles bytes must not hold a buffer and a permit for long.
        using CancellationTokenSource deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(ReadTimeout);

        // Never size the buffer from the client-declared length: it grows with the bytes actually received.
        ArrayBufferWriter<byte> buffer = new(64 * 1024);
        try
        {
            while (true)
            {
                Memory<byte> span = buffer.GetMemory(Math.Min(81920, limit - buffer.WrittenCount + 1));
                int read = await context.Request.Body.ReadAsync(span, deadline.Token);
                if (read == 0)
                {
                    return buffer.WrittenMemory;
                }

                buffer.Advance(read);
                if (buffer.WrittenCount > limit)
                {
                    return null;
                }
            }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new TimeoutException("The request body was not received in time.");
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            return null;
        }
    }
}
