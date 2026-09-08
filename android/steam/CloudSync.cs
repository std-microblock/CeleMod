using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using SteamKit2;
using SteamKit2.Internal;

namespace CeleMod.Steam;

internal sealed class CloudSync(Session session, string game, string state)
{
    private const int FileLimit = 64 * 1024 * 1024;
    private readonly string saves = Path.Combine(game, "Saves");
    private sealed record RemoteFile(string Name, byte[] Hash, uint Size, ulong Time);
    private sealed record ConflictSnapshot(Dictionary<string, string> Local, Dictionary<string, string> Remote);
    private string LocalPath(string name) => SafeFiles.Under(saves, SyncPlan.SaveName(name));
    private static Dictionary<string, string> ReadHashes(string file) => File.Exists(file) ?
        JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(file), Program.Json)! : new(StringComparer.Ordinal);
    private Dictionary<string, string> LocalHashes() => Directory.Exists(saves) ? Directory.EnumerateFiles(saves, "*.celeste")
        .ToDictionary(p => "Saves/" + Path.GetFileName(p), p => SafeFiles.Hash(LocalPath("Saves/" + Path.GetFileName(p))), StringComparer.Ordinal) : new(StringComparer.Ordinal);

    private static T Body<T>(SteamUnifiedMessages.ServiceMethodResponse<T> response) where T : ProtoBuf.IExtensible, new()
    {
        Session.Check(response.Result, "Steam 云存档"); return response.Body;
    }
    private async Task<Dictionary<string, RemoteFile>> List()
    {
        var reply = Body(await session.Cloud.GetAppFileChangelist(new CCloud_GetAppFileChangelist_Request { appid = Session.AppId })
            .ToTask().WaitAsync(Program.Cancel));
        if (reply.is_only_delta) throw new SteamFailure("Steam 未返回完整的云存档清单，已停止同步。");
        var result = new Dictionary<string, RemoteFile>(StringComparer.Ordinal);
        foreach (var file in reply.files) {
            var name = SyncPlan.RemoteName(reply.path_prefixes, file.path_prefix_index, file.file_name);
            // Fail closed on unknown files rather than mapping two names onto the same save.
            SyncPlan.SaveName(name);
            if (file.persist_state == ECloudStoragePersistState.k_ECloudStoragePersistStateDeleted) continue;
            if (file.persist_state != ECloudStoragePersistState.k_ECloudStoragePersistStatePersisted)
                throw new SteamFailure("其他设备的云存档尚未提交，请在 PC 端完成同步后重试。");
            if (file.sha_file is not { Length: 20 } || file.raw_file_size > FileLimit || !result.TryAdd(name, new(name, file.sha_file, file.raw_file_size, file.time_stamp)))
                throw new InvalidDataException("Steam 云存档清单重复、过大或无效。");
        }
        if (result.Count > 1000 || result.Values.Sum(f => (long)f.Size) > 1_000_000_000)
            throw new InvalidDataException("Steam 云存档超过 Celeste 的安全同步限制。");
        return result;
    }
    private static Dictionary<string, string> Hashes(Dictionary<string, RemoteFile> files) =>
        files.ToDictionary(f => f.Key, f => Convert.ToHexString(f.Value.Hash), StringComparer.Ordinal);

    internal async Task Run(string? choice, string phase = "manual")
    {
        if (choice != null && choice is not "local" and not "cloud") throw new InvalidOperationException("未知的冲突处理选项。");
        if (session.ClientId == 0) throw new SteamFailure("请重新登录 Steam，以建立云存档设备身份。");
        await session.OwnedDepot();
        if (phase == "launch") {
            var intent = Body(await session.Cloud.SignalAppLaunchIntent(new CCloud_AppLaunchIntent_Request {
                appid = Session.AppId, client_id = session.ClientId, machine_name = "CeleMod Android", ignore_pending_operations = false
            }).ToTask().WaitAsync(Program.Cancel));
            if (intent.pending_remote_operations.Count > 0)
                throw new SteamFailure("Steam 提示其他设备仍有游戏/云存档操作未结束。请先退出 PC 游戏并完成同步，或明确选择离线模式。");
        }
        void NotifyExit(bool uploads) {
            if (phase == "exit") session.Cloud.SignalAppExitSyncDone(new CCloud_AppExitSyncDone_Notification {
                appid = Session.AppId, client_id = session.ClientId, uploads_completed = true, uploads_required = uploads
            });
        }
        var rules = (await session.AppInfo())["ufs"]["savefiles"].Children;
        if (rules.Count != 1 || !string.Equals(rules[0]["root"].AsString(), "gameinstall", StringComparison.OrdinalIgnoreCase) ||
            rules[0]["path"].AsString() != "Saves" || rules[0]["pattern"].AsString() != "*.celeste")
            throw new SteamFailure("Celeste 的 Steam 云存档规则已变化，请升级 CeleMod；未修改存档。");
        Directory.CreateDirectory(state);
        var accountFile = Path.Combine(state, "account.json");
        if (File.Exists(accountFile) && File.ReadAllText(accountFile) != session.SteamId)
            throw new SteamFailure("存档同步目录属于其他 Steam 账号，已拒绝跨账号同步。");
        File.WriteAllText(accountFile, session.SteamId);
        var baselinePath = Path.Combine(state, "baseline.json");
        var conflictPath = Path.Combine(state, "conflict.json");
        Program.Status("syncing", "正在比较本地与 Steam 云存档…");
        var remoteFiles = await List(); var remote = Hashes(remoteFiles); var local = LocalHashes();
        foreach (var name in local.Keys) if (new FileInfo(LocalPath(name)).Length > FileLimit) throw new InvalidDataException("本地存档超过 64 MiB，已停止同步。");
        var plan = SyncPlan.Build(ReadHashes(baselinePath), local, remote);
        var conflicts = plan.Where(p => p.Action == SyncAction.Conflict).ToList();
        if (conflicts.Count > 0) {
            var previous = File.Exists(conflictPath) ? JsonSerializer.Deserialize<ConflictSnapshot>(File.ReadAllText(conflictPath), Program.Json) : null;
            if (choice == null || previous == null || !SyncPlan.Same(previous.Local, local) || !SyncPlan.Same(previous.Remote, remote)) {
                Program.Write(conflictPath, new ConflictSnapshot(local, remote));
                throw new CloudConflictException(conflicts);
            }
            plan = plan.Select(p => p.Action == SyncAction.Conflict ? p with { Action = choice == "local" ? SyncAction.Push : SyncAction.Pull } : p).ToList();
        }
        var work = plan.Where(p => p.Action != SyncAction.None).ToList();
        if (work.Count == 0) { Program.Write(baselinePath, local); File.Delete(conflictPath); NotifyExit(false); return; }
        // Persist BOTH versions before any overwrite/deletion. A failed sync never discards these snapshots.
        var backup = Path.Combine(state, "backups", DateTime.UtcNow.ToString("yyyyMMddTHHmmssfff") + "-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(backup);
        Program.Write(Path.Combine(backup, "plan.json"), plan);
        using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(60) };
        foreach (var entry in work) {
            Program.Cancel.ThrowIfCancellationRequested();
            if (entry.Local != null) {
                var copy = SafeFiles.Under(backup, "local/" + entry.Name);
                Directory.CreateDirectory(Path.GetDirectoryName(copy)!); File.Copy(LocalPath(entry.Name), copy);
                if (SafeFiles.Hash(copy) != entry.Local) throw new SteamFailure("本地存档在同步过程中发生变化，请退出游戏后重试。");
            }
            if (entry.Remote != null) await Download(http, remoteFiles[entry.Name], SafeFiles.Under(backup, "cloud/" + entry.Name));
        }
        if (!SyncPlan.Same(local, LocalHashes()) || !SyncPlan.Same(remote, Hashes(await List())))
            throw new SteamFailure("同步期间存档发生变化，备份已保留，请重试。");
        var pushes = work.Where(p => p.Action == SyncAction.Push).ToList();
        if (pushes.Count > 0) {
            var quota = Body(await session.Cloud.ClientGetAppQuotaUsage(new CCloud_ClientGetAppQuotaUsage_Request { appid = Session.AppId }).ToTask().WaitAsync(Program.Cancel));
            var expected = new Dictionary<string, long>(remoteFiles.ToDictionary(p => p.Key, p => (long)p.Value.Size));
            foreach (var entry in pushes) { if (entry.Local == null) expected.Remove(entry.Name); else expected[entry.Name] = new FileInfo(LocalPath(entry.Name)).Length; }
            if (expected.Count > quota.max_num_files || (ulong)expected.Values.Sum() > quota.max_num_bytes)
                throw new SteamFailure("Steam 云存档配额不足，未开始上传。");
            var begin = new CCloud_BeginAppUploadBatch_Request { appid = Session.AppId, machine_name = "CeleMod Android", client_id = session.ClientId };
            begin.files_to_upload.AddRange(pushes.Where(p => p.Local != null).Select(p => p.Name));
            begin.files_to_delete.AddRange(pushes.Where(p => p.Local == null).Select(p => p.Name));
            var batch = Body(await session.Cloud.BeginAppUploadBatch(begin).ToTask().WaitAsync(Program.Cancel));
            var success = false;
            try {
                foreach (var entry in pushes) {
                    if (entry.Local == null) Body(await session.Cloud.ClientDeleteFile(new CCloud_ClientDeleteFile_Request {
                        appid = Session.AppId, filename = entry.Name, is_explicit_delete = true, upload_batch_id = batch.batch_id
                    }).ToTask().WaitAsync(Program.Cancel));
                    else await Upload(http, entry.Name, SafeFiles.Under(backup, "local/" + entry.Name), batch.batch_id);
                }
                success = true;
            } finally {
                // The blocking completion acknowledgement is required; never mark a failed/partial batch synced.
                Body(await session.Cloud.CompleteAppUploadBatchBlocking(new CCloud_CompleteAppUploadBatch_Request {
                    appid = Session.AppId, batch_id = batch.batch_id, batch_eresult = (uint)(success ? EResult.OK : EResult.Fail)
                }).ToTask().WaitAsync(TimeSpan.FromSeconds(30)));
            }
        }
        if (!SyncPlan.Same(local, LocalHashes())) throw new SteamFailure("本地存档发生变化，停止写回；两端备份已保留。");
        var desired = new Dictionary<string, string>(local);
        foreach (var entry in work.Where(p => p.Action == SyncAction.Pull)) {
            if (entry.Remote == null) desired.Remove(entry.Name); else desired[entry.Name] = entry.Remote;
        }
        if (!SyncPlan.Same(desired, Hashes(await List()))) throw new SteamFailure("云端在同步期间变化或尚未确认上传，请重试；不会标记为已同步。");
        foreach (var entry in work.Where(p => p.Action == SyncAction.Pull)) {
            var path = LocalPath(entry.Name);
            if (entry.Remote == null) File.Delete(path);
            else {
                Directory.CreateDirectory(saves);
                var temp = path + ".celemod-cloud-part";
                File.Copy(SafeFiles.Under(backup, "cloud/" + entry.Name), temp, true);
                SafeFiles.Replace(temp, path);
                File.SetLastWriteTimeUtc(path, DateTimeOffset.FromUnixTimeSeconds(checked((long)remoteFiles[entry.Name].Time)).UtcDateTime);
            }
        }
        if (!SyncPlan.Same(desired, LocalHashes())) throw new SteamFailure("存档写回校验失败，请重试。");
        Program.Write(baselinePath, desired);
        File.Delete(conflictPath);
        NotifyExit(pushes.Count > 0);
    }

    private static Uri Url(string host, string path)
    {
        // Never send signed Steam instructions over cleartext HTTP or follow redirects carrying their headers.
        if (!Uri.TryCreate("https://" + host + path, UriKind.Absolute, out var uri) || uri.UserInfo != "" || uri.Port != 443 || uri.HostNameType != UriHostNameType.Dns ||
            !new[] { "steamcontent.com", "steamusercontent.com", "steampowered.com", "steamstatic.com", "amazonaws.com" }.Any(d => uri.Host == d || uri.Host.EndsWith("." + d, StringComparison.OrdinalIgnoreCase)))
            throw new InvalidDataException("Steam 返回了不支持的云存储地址，已停止传输。");
        return uri;
    }
    private static void Headers(HttpRequestMessage request, IEnumerable<(string name, string value)> headers) {
        foreach (var header in headers) {
            if (header.name.Equals("Host", StringComparison.OrdinalIgnoreCase) || header.name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) continue;
            if (!request.Headers.TryAddWithoutValidation(header.name, header.value)) request.Content?.Headers.TryAddWithoutValidation(header.name, header.value);
        }
    }
    private async Task Download(HttpClient http, RemoteFile file, string destination)
    {
        Program.Status("syncing", "下载云存档 " + file.Name);
        var info = Body(await session.Cloud.ClientFileDownload(new CCloud_ClientFileDownload_Request { appid = Session.AppId, filename = file.Name }).ToTask().WaitAsync(Program.Cancel));
        if (info.encrypted || info.is_explicit_delete || info.raw_file_size != file.Size || !info.sha_file.SequenceEqual(file.Hash))
            throw new InvalidDataException("云存档版本已变化或使用了不支持的加密格式。");
        using var request = new HttpRequestMessage(HttpMethod.Get, Url(info.url_host, info.url_path)); Headers(request, info.request_headers.Select(h => (h.name, h.value)));
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, Program.Cancel);
        response.EnsureSuccessStatusCode();
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        await using (var input = await response.Content.ReadAsStreamAsync(Program.Cancel))
        await using (var output = File.Create(destination)) {
            var buffer = new byte[65536]; long total = 0;
            while (true) {
                var n = await input.ReadAsync(buffer, Program.Cancel); if (n == 0) break;
                total += n; if (total > FileLimit) throw new InvalidDataException("云存档下载超过安全大小限制。");
                await output.WriteAsync(buffer.AsMemory(0, n), Program.Cancel);
            }
        }
        if (info.file_size != info.raw_file_size) CloudPayload.Unpack(destination, file.Size);
        SafeFiles.Verify(destination, file.Hash, file.Size);
    }
    private async Task Upload(HttpClient http, string name, string snapshot, ulong batch)
    {
        Program.Status("syncing", "上传云存档 " + name);
        var bytes = await File.ReadAllBytesAsync(snapshot, Program.Cancel); var hash = SHA1.HashData(bytes);
        var info = Body(await session.Cloud.ClientBeginFileUpload(new CCloud_ClientBeginFileUpload_Request {
            appid = Session.AppId, filename = name, file_size = (uint)bytes.Length, raw_file_size = (uint)bytes.Length,
            file_sha = hash, time_stamp = (ulong)new DateTimeOffset(File.GetLastWriteTimeUtc(snapshot)).ToUnixTimeSeconds(),
            platforms_to_sync = uint.MaxValue, can_encrypt = false, upload_batch_id = batch
        }).ToTask().WaitAsync(Program.Cancel));
        if (info.encrypt_file || info.block_requests.Count == 0) throw new SteamFailure("Steam 未提供可用的上传请求。");
        var success = false;
        try {
            foreach (var block in info.block_requests) {
                byte[] body;
                if (block.explicit_body_data is { Length: > 0 }) body = block.explicit_body_data;
                else {
                    if (block.block_offset + block.block_length > (ulong)bytes.Length) throw new InvalidDataException("云上传分块越界。");
                    body = bytes.AsSpan((int)block.block_offset, (int)block.block_length).ToArray();
                }
                using var request = new HttpRequestMessage(HttpMethod.Put, Url(block.url_host, block.url_path)) { Content = new ByteArrayContent(body) };
                Headers(request, block.request_headers.Select(h => (h.name, h.value)));
                using var response = await http.SendAsync(request, Program.Cancel); response.EnsureSuccessStatusCode();
            }
            success = true;
        } finally {
            var commit = Body(await session.Cloud.ClientCommitFileUpload(new CCloud_ClientCommitFileUpload_Request {
                appid = Session.AppId, filename = name, file_sha = hash, transfer_succeeded = success
            }).ToTask().WaitAsync(TimeSpan.FromSeconds(30)));
            if (success && !commit.file_committed) throw new SteamFailure("Steam 未确认存档提交成功，请重试。");
        }
    }
}
