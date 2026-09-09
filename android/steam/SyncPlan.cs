namespace CeleMod.Steam;

internal enum SyncAction { None, Pull, Push, Conflict }
internal sealed record SyncEntry(string Name, string? Local, string? Remote, SyncAction Action);
internal sealed class CloudConflictException(IReadOnlyList<SyncEntry> files) : Exception
{
    internal IReadOnlyList<SyncEntry> Files => files;
}

internal static class SyncPlan
{
    // Absence is a version too. Only delete when the baseline proves this is a deletion, not a first sync.
    internal static SyncAction Decide(string? baseline, string? local, string? remote) =>
        local == remote ? SyncAction.None : local == baseline ? SyncAction.Pull : remote == baseline ? SyncAction.Push : SyncAction.Conflict;

    internal static List<SyncEntry> Build(Dictionary<string, string> baseline, Dictionary<string, string> local, Dictionary<string, string> remote) =>
        baseline.Keys.Union(local.Keys).Union(remote.Keys).Order(StringComparer.Ordinal).Select(name => {
            baseline.TryGetValue(name, out var b); local.TryGetValue(name, out var l); remote.TryGetValue(name, out var r);
            return new SyncEntry(name, l, r, Decide(b, l, r));
        }).ToList();

    internal static bool Same(Dictionary<string, string> a, Dictionary<string, string> b) =>
        a.Count == b.Count && a.All(x => b.TryGetValue(x.Key, out var hash) && hash == x.Value);

    internal static string SaveName(string remote)
    {
        remote = remote.Replace('\\', '/');
        // Auto-Cloud includes its root token in the wire filename. It is not a
        // local directory. Accept only Celeste's validated GameInstall rule.
        if (remote.StartsWith("%GameInstall%", StringComparison.Ordinal)) {
            remote = remote[13..];
            if (remote.StartsWith('/')) remote = remote[1..];
        }
        // Celeste's Steam Auto-Cloud rule is GameInstall/Saves/*.celeste (not recursive).
        if (!remote.StartsWith("Saves/", StringComparison.Ordinal) || !remote.EndsWith(".celeste", StringComparison.Ordinal) ||
            remote[6..].Contains('/') || remote[6..].Contains(':') || remote.Contains('\0') || remote[6..].StartsWith('.'))
            throw new InvalidDataException("Steam 云端文件路径不符合 Celeste 存档规则：" +
                System.Text.Json.JsonSerializer.Serialize(remote.Length > 200 ? remote[..200] + "…" : remote) + "；未覆盖任何存档。");
        return remote[6..];
    }

    internal static string SaveKey(string remote) => "Saves/" + SaveName(remote);

    internal static string UploadName(string local, string? existing = null)
    {
        var key = SaveKey(local);
        if (existing == null) return "%GameInstall%" + key;
        if (SaveKey(existing) != key) throw new InvalidDataException("云存档名称与本地存档不匹配。");
        return existing;
    }

    internal static string RemoteName(IReadOnlyList<string> prefixes, uint index, string filename)
    {
        // Steam may use a sentinel/out-of-range index to indicate that the filename has no prefix.
        var prefix = index < prefixes.Count ? prefixes[(int)index] : "";
        var separator = prefix.Length == 0 || prefix.EndsWith('/') || prefix.EndsWith('\\') ? "" : "/";
        var name = prefix + separator + filename;
        SaveName(name);
        return name;
    }
}
