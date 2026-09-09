namespace CeleMod.Steam;

internal sealed record CloudProgressSnapshot(long Done, long Total, long CompletedBytes, long TotalBytes,
    long TransferredBytes, long CachedFiles, string Phase, string Message, string? CurrentFile, int RetryAttempt);

/** Serializes/throttles IPC writes from concurrent transfers. Only verified files count as completed. */
internal sealed class CloudProgress(long totalFiles, long totalBytes, Action<CloudProgressSnapshot> publish)
{
    private readonly object gate = new();
    private long done, completed, transferred, cached, lastReport;
    private string phase = "download", message = "正在下载云存档…";
    private string? currentFile;
    private int retry;

    private void Report(bool force)
    {
        var now = Environment.TickCount64;
        if (!force && now - lastReport < 200) return;
        lastReport = now;
        publish(new(done, totalFiles, completed, totalBytes, transferred, cached, phase, message, currentFile, retry));
    }
    internal void Stage(string value, string text) { lock (gate) { phase = value; message = text; currentFile = null; retry = 0; Report(true); } }
    internal void Start(string name, int attempt = 1, string? reason = null) {
        lock (gate) {
            currentFile = name; retry = attempt;
            message = reason == null ? "正在传输 " + name : $"{name}：{reason}，正在重试（{attempt}/3）";
            Report(true);
        }
    }
    internal void Bytes(long count) { lock (gate) { transferred += count; Report(false); } }
    internal void Complete(long bytes, bool fromCache = false) {
        lock (gate) { done++; completed += bytes; if (fromCache) cached++; Report(true); }
    }
}
