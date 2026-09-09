using System.Net;

namespace CeleMod.Steam;

/** Retries only downloads, never blind retries of cloud writes. Signed URLs stay out of diagnostics. */
internal static class CloudTransfer
{
    internal static bool Retryable(Exception error, CancellationToken cancel) => !cancel.IsCancellationRequested &&
        (error is OperationCanceledException or TimeoutException ||
         error is HttpRequestException http && (http.StatusCode == null || http.StatusCode is HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests || (int)http.StatusCode >= 500) ||
         error is IOException && error is not InvalidDataException);

    internal static string Reason(Exception error) => error switch {
        OperationCanceledException or TimeoutException => "连接或读取超时",
        HttpRequestException http when http.StatusCode != null => "HTTP " + (int)http.StatusCode,
        HttpRequestException => "网络连接失败",
        _ => "传输中断"
    };

    internal static async Task Receive(HttpClient http, HttpRequestMessage request, string destination,
        long limit, Action<long> progress, CancellationToken cancel, TimeSpan? idleTimeout = null)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        var idle = idleTimeout ?? TimeSpan.FromSeconds(25);
        timeout.CancelAfter(idle);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > limit) throw new InvalidDataException("云存档下载超过安全大小限制。");
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        await using var input = await response.Content.ReadAsStreamAsync(timeout.Token);
        await using var output = File.Create(destination);
        var buffer = new byte[65536]; long total = 0;
        while (true) {
            timeout.CancelAfter(idle); // Include body reads; HttpClient.Timeout alone ends at response headers.
            var count = await input.ReadAsync(buffer, timeout.Token);
            if (count == 0) break;
            total += count;
            if (total > limit) throw new InvalidDataException("云存档下载超过安全大小限制。");
            await output.WriteAsync(buffer.AsMemory(0, count), cancel);
            progress(count);
        }
    }

    internal static bool UseCache(string cache, string destination, byte[] hash, long size)
    {
        if (!File.Exists(cache)) return false;
        try { SafeFiles.Verify(cache, hash, size); }
        catch (InvalidDataException) { return false; }
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        File.Copy(cache, destination, true);
        return true;
    }
}
