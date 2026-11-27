using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

namespace Polymnia.Tests;

internal enum FakeSmtpMode
{
    /// <summary>Plain connection, offers STARTTLS (the normal submission port).</summary>
    StartTls,

    /// <summary>TLS from the first byte (the normal SMTPS port).</summary>
    Implicit,

    /// <summary>Plain connection that never offers STARTTLS: a client that requires TLS must give up.</summary>
    NoTls,
}

/// <summary>One command line the server read, and whether it arrived over TLS.</summary>
internal sealed record SmtpCommand(string Line, bool Tls);

/// <summary>One message the server accepted.</summary>
internal sealed record SmtpReceived(string MailFrom, IReadOnlyList<string> RcptTo, string Raw);

/// <summary>
/// A small SMTP server for the tests: loopback, any free port, a self-signed certificate. It speaks just enough of the
/// protocol (EHLO, STARTTLS, AUTH PLAIN, MAIL, RCPT, DATA, QUIT) and records what it saw, to check what travelled and how.
/// </summary>
internal sealed class FakeSmtpServer : IDisposable
{
    public const string User = "smtp-user";
    public const string Password = "smtp-secret-password";

    private static readonly X509Certificate2 Certificate = CreateCertificate();

    private readonly TcpListener _listener;
    private readonly FakeSmtpMode _mode;
    private readonly CancellationTokenSource _stop = new();
    private readonly Task _loop;
    private readonly object _gate = new();
    private readonly List<SmtpCommand> _commands = [];
    private readonly List<SmtpReceived> _messages = [];
    private int _failures;

    public FakeSmtpServer(FakeSmtpMode mode = FakeSmtpMode.StartTls)
    {
        _mode = mode;
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _loop = Task.Run(AcceptLoopAsync);
    }

    public int Port { get; }

    public IReadOnlyList<SmtpCommand> Commands
    {
        get
        {
            lock (_gate)
            {
                return [.. _commands];
            }
        }
    }

    public IReadOnlyList<SmtpReceived> Messages
    {
        get
        {
            lock (_gate)
            {
                return [.. _messages];
            }
        }
    }

    /// <summary>The next <paramref name="count"/> messages are refused with a permanent error at <c>RCPT TO</c>.</summary>
    public void FailNext(int count) => Interlocked.Exchange(ref _failures, count);

    /// <summary>Every message from now on is refused (until <see cref="FailNext"/> is called with 0).</summary>
    public void FailAlways() => Interlocked.Exchange(ref _failures, int.MaxValue / 2);

    public async Task<SmtpReceived> WaitForMessageAsync(int index = 0, int seconds = 15)
    {
        DateTime deadline = DateTime.UtcNow.AddSeconds(seconds);
        while (DateTime.UtcNow < deadline)
        {
            IReadOnlyList<SmtpReceived> messages = Messages;
            if (messages.Count > index)
            {
                return messages[index];
            }

            await Task.Delay(50, TestContext.Current.CancellationToken);
        }

        throw new TimeoutException("The fake SMTP server received no message in time.");
    }

    public void Dispose()
    {
        _stop.Cancel();
        _listener.Stop();
        try
        {
            _loop.Wait(TimeSpan.FromSeconds(2));
        }
        catch (AggregateException)
        {
            // The accept loop ends with an exception when the listener stops.
        }

        _stop.Dispose();
    }

    private static X509Certificate2 CreateCertificate()
    {
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest("CN=fake-smtp", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using X509Certificate2 ephemeral = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(2));
        // SChannel needs a key it can use for a server handshake: round-trip through PKCS#12.
        return X509CertificateLoader.LoadPkcs12(ephemeral.Export(X509ContentType.Pfx), null);
    }

    private async Task AcceptLoopAsync()
    {
        while (!_stop.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await _listener.AcceptTcpClientAsync(_stop.Token);
            }
            catch (Exception ex) when (ex is OperationCanceledException or ObjectDisposedException or SocketException)
            {
                return;
            }

            _ = Task.Run(() => ServeAsync(client));
        }
    }

    private async Task ServeAsync(TcpClient client)
    {
        using (client)
        {
            try
            {
                Stream stream = client.GetStream();
                bool tls = false;
                if (_mode == FakeSmtpMode.Implicit)
                {
                    stream = await UpgradeAsync(stream);
                    tls = true;
                }

                await ConversationAsync(stream, tls);
            }
            catch (Exception ex) when (ex is IOException or ObjectDisposedException or OperationCanceledException or System.Security.Authentication.AuthenticationException or SocketException)
            {
                // The client hung up (for example because it refused to go on without TLS).
            }
        }
    }

    private static async Task<Stream> UpgradeAsync(Stream inner)
    {
        var ssl = new SslStream(inner, leaveInnerStreamOpen: false);
        await ssl.AuthenticateAsServerAsync(Certificate);
        return ssl;
    }

    private async Task ConversationAsync(Stream stream, bool tls)
    {
        var reader = new LineReader(stream);
        await WriteAsync(stream, "220 fake.smtp.example ESMTP ready");
        string mailFrom = string.Empty;
        List<string> rcpt = [];
        while (await reader.ReadLineAsync(_stop.Token) is { } line)
        {
            Record(line, tls);
            string upper = line.ToUpperInvariant();
            if (upper.StartsWith("EHLO", StringComparison.Ordinal) || upper.StartsWith("HELO", StringComparison.Ordinal))
            {
                List<string> lines = ["fake.smtp.example", "8BITMIME", "SIZE 1000000"];
                if (_mode == FakeSmtpMode.StartTls && !tls)
                {
                    lines.Add("STARTTLS");
                }

                if (tls)
                {
                    lines.Add("AUTH PLAIN");
                }

                for (int i = 0; i < lines.Count; i++)
                {
                    await WriteAsync(stream, (i == lines.Count - 1 ? "250 " : "250-") + lines[i]);
                }
            }
            else if (upper == "STARTTLS" && _mode == FakeSmtpMode.StartTls && !tls)
            {
                await WriteAsync(stream, "220 Ready to start TLS");
                stream = await UpgradeAsync(stream);
                reader = new LineReader(stream);
                tls = true;
            }
            else if (upper.StartsWith("AUTH PLAIN", StringComparison.Ordinal))
            {
                string payload = line.Length > 11 ? line[11..] : string.Empty;
                if (payload.Length == 0)
                {
                    await WriteAsync(stream, "334 ");
                    payload = await reader.ReadLineAsync(_stop.Token) ?? string.Empty;
                    Record("<AUTH response>", tls);
                }

                string[] parts = Encoding.UTF8.GetString(Convert.FromBase64String(payload)).Split('\0');
                bool ok = parts.Length == 3 && parts[1] == User && parts[2] == Password;
                await WriteAsync(stream, ok ? "235 2.7.0 Authentication successful" : "535 5.7.8 Authentication failed");
            }
            else if (upper.StartsWith("MAIL FROM:", StringComparison.Ordinal))
            {
                mailFrom = line[10..].Trim();
                rcpt = [];
                await WriteAsync(stream, "250 OK");
            }
            else if (upper.StartsWith("RCPT TO:", StringComparison.Ordinal))
            {
                if (TakeFailure())
                {
                    await WriteAsync(stream, "550 5.1.1 Mailbox unavailable");
                }
                else
                {
                    rcpt.Add(line[8..].Trim());
                    await WriteAsync(stream, "250 OK");
                }
            }
            else if (upper == "DATA")
            {
                if (rcpt.Count == 0)
                {
                    await WriteAsync(stream, "503 5.5.1 Need RCPT first");
                    continue;
                }

                await WriteAsync(stream, "354 End data with <CR><LF>.<CR><LF>");
                StringBuilder data = new();
                while (await reader.ReadLineAsync(_stop.Token) is { } dataLine && dataLine != ".")
                {
                    data.Append(dataLine.StartsWith("..", StringComparison.Ordinal) ? dataLine[1..] : dataLine).Append("\r\n");
                }

                lock (_gate)
                {
                    _messages.Add(new SmtpReceived(mailFrom, rcpt, data.ToString()));
                }

                await WriteAsync(stream, "250 2.0.0 Queued");
            }
            else if (upper == "QUIT")
            {
                await WriteAsync(stream, "221 2.0.0 Bye");
                return;
            }
            else
            {
                await WriteAsync(stream, "250 OK");
            }
        }
    }

    private bool TakeFailure()
    {
        while (true)
        {
            int current = Volatile.Read(ref _failures);
            if (current <= 0)
            {
                return false;
            }

            if (Interlocked.CompareExchange(ref _failures, current - 1, current) == current)
            {
                return true;
            }
        }
    }

    private void Record(string line, bool tls)
    {
        lock (_gate)
        {
            _commands.Add(new SmtpCommand(line, tls));
        }
    }

    private static async Task WriteAsync(Stream stream, string line)
    {
        byte[] bytes = Encoding.ASCII.GetBytes(line + "\r\n");
        await stream.WriteAsync(bytes);
        await stream.FlushAsync();
    }

    /// <summary>Reads CRLF-terminated lines without over-reading (the stream may be upgraded to TLS afterwards).</summary>
    private sealed class LineReader(Stream stream)
    {
        public async Task<string?> ReadLineAsync(CancellationToken ct)
        {
            List<byte> bytes = [];
            byte[] one = new byte[1];
            while (true)
            {
                int read = await stream.ReadAsync(one, ct);
                if (read == 0)
                {
                    return bytes.Count == 0 ? null : Encoding.UTF8.GetString([.. bytes]);
                }

                if (one[0] == (byte)'\n')
                {
                    if (bytes.Count > 0 && bytes[^1] == (byte)'\r')
                    {
                        bytes.RemoveAt(bytes.Count - 1);
                    }

                    return Encoding.UTF8.GetString([.. bytes]);
                }

                bytes.Add(one[0]);
            }
        }
    }
}
