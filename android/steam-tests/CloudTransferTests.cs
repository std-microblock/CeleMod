using System.Net;
using System.Security.Cryptography;
using CeleMod.Steam;

internal static class CloudTransferTests
{
    internal static async Task<int> Run()
    {
        var assertions = 0;
        void Check(bool value, string message) { assertions++; if (!value) throw new Exception(message); }
        var snapshots = new List<CloudProgressSnapshot>();
        var meter = new CloudProgress(100, 1000, snapshots.Add);
        meter.Stage("download", "start");
        await Task.WhenAll(Enumerable.Range(0, 100).Select(i => Task.Run(() => { meter.Bytes(11); meter.Complete(10, i % 2 == 0); })));
        var last = snapshots[^1];
        Check(last.Done == 100 && last.CompletedBytes == 1000 && last.TransferredBytes == 1100 && last.CachedFiles == 50, "Concurrent progress is exact, including retry/cache bytes");
        Check(snapshots.Zip(snapshots.Skip(1)).All(pair => pair.First.Done <= pair.Second.Done && pair.First.TransferredBytes <= pair.Second.TransferredBytes), "Published progress never regresses");
        meter.Stage("verify", "verify"); Check(snapshots[^1].Phase == "verify", "Transfers are not claimed as successful before verification");
        Check(CloudTransfer.Retryable(new HttpRequestException("secret", null, HttpStatusCode.ServiceUnavailable), default), "Retry HTTP 503");
        Check(!CloudTransfer.Retryable(new HttpRequestException("secret", null, HttpStatusCode.Forbidden), default), "Do not retry permission rejection");
        Check(!CloudTransfer.Retryable(new InvalidDataException("bad hash"), default), "Integrity failures are not transport retries");
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        Check(!CloudTransfer.Retryable(new OperationCanceledException(), cancelled.Token), "Cancellation is never retried");
        Check(!CloudTransfer.Reason(new HttpRequestException("https://signed-url?token=secret")).Contains("secret"), "Diagnostics redact exception URLs");
        var directory = Path.Combine(Path.GetTempPath(), "celemod-transfer-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try {
            var bytes = "a verified cloud save"u8.ToArray();
            using var client = new HttpClient(new Handler(() => new ByteArrayContent(bytes)));
            using var request = new HttpRequestMessage(HttpMethod.Get, "https://test.invalid/save");
            var path = Path.Combine(directory, "save"); long received = 0;
            await CloudTransfer.Receive(client, request, path, 1024, n => received += n, default);
            Check(received == bytes.Length && File.ReadAllBytes(path).SequenceEqual(bytes), "Actual bytes and saved bytes match");
            var destination = Path.Combine(directory, "copy");
            Check(CloudTransfer.UseCache(path, destination, SHA1.HashData(bytes), bytes.Length), "Verified cache skips the network");
            File.WriteAllText(path, "corrupted");
            Check(!CloudTransfer.UseCache(path, destination, SHA1.HashData(bytes), bytes.Length), "Corrupt cache is rejected");
            Check(File.ReadAllBytes(destination).SequenceEqual(bytes), "Corrupt cache cannot overwrite a good snapshot");
            using var stalled = new HttpClient(new Handler(() => new StreamContent(new StallStream())));
            using var stallRequest = new HttpRequestMessage(HttpMethod.Get, "https://test.invalid/stall");
            var timedOut = false;
            try { await CloudTransfer.Receive(stalled, stallRequest, path, 1024, _ => { }, default, TimeSpan.FromMilliseconds(50)); }
            catch (OperationCanceledException) { timedOut = true; }
            Check(timedOut, "Body stalls after headers have a bounded timeout");
            using var oversized = new HttpRequestMessage(HttpMethod.Get, "https://test.invalid/oversized");
            var rejected = false;
            try { await CloudTransfer.Receive(client, oversized, path, 1, _ => { }, default); }
            catch (InvalidDataException) { rejected = true; }
            Check(rejected, "Oversized cloud bodies are rejected");
        } finally { Directory.Delete(directory, true); }
        return assertions;
    }
    private sealed class Handler(Func<HttpContent> content) : HttpMessageHandler {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = content() });
    }
    private sealed class StallStream : MemoryStream {
        public override bool CanSeek => false;
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) {
            await Task.Delay(Timeout.Infinite, cancellationToken); return 0;
        }
    }
}
