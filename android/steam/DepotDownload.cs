using System.Reflection.PortableExecutable;
using SteamKit2;
using SteamKit2.CDN;

namespace CeleMod.Steam;

internal sealed class DepotDownload(Session session)
{
    internal async Task Run(string destination, string state)
    {
        // Never update in place: Everest rewrites the original assemblies; a depot repair would destroy it.
        if (Directory.Exists(destination)) {
            var receiptPath = Path.Combine(state, "install.json");
            if (File.Exists(receiptPath)) {
                var receipt = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(receiptPath))!;
                if (receipt["steamId"]?.GetValue<string>() == session.SteamId && receipt["game"]?.GetValue<string>() == destination &&
                    File.Exists(Path.Combine(destination, "Celeste.exe")) && Directory.Exists(Path.Combine(destination, "Content"))) {
                    await session.OwnedDepot();
                    return; // Recover a crash between atomic directory publication and Android binding persistence.
                }
            }
            throw new InvalidOperationException("此 Steam 游戏目录已存在。不会覆盖现有游戏、Mods 或存档。");
        }
        var (depot, manifestId, key) = await session.OwnedDepot();
        var requestCode = await session.Content.GetManifestRequestCode(depot, Session.AppId, manifestId).WaitAsync(Program.Cancel);
        if (requestCode == 0) throw new SteamFailure("Steam 拒绝访问资源清单，请确认账号拥有 Celeste。");
        var servers = (await session.Content.GetServersForSteamPipe().WaitAsync(Program.Cancel))
            .Where(s => !string.IsNullOrEmpty(s.Host) && s.Type is "SteamCache" or "CDN").Take(12).ToList();
        if (servers.Count == 0) throw new SteamFailure("Steam 没有返回可用的下载服务器。");
        using var cdn = new Client(session.Client);
        Client.RequestTimeout = TimeSpan.FromSeconds(45);
        var tokens = new Dictionary<string, string>();
        async Task<T> Download<T>(Func<Server, string?, Task<T>> call) {
            Exception? last = null;
            for (var attempt = 0; attempt < Math.Min(servers.Count * 2, 8); attempt++) {
                Program.Cancel.ThrowIfCancellationRequested();
                var server = servers[attempt % servers.Count];
                try {
                    try {
                        tokens.TryGetValue(server.Host!, out var token);
                        return await call(server, token).WaitAsync(Program.Cancel);
                    } catch (SteamKitWebRequestException e) when (e.StatusCode == System.Net.HttpStatusCode.Forbidden) {
                        var auth = await session.Content.GetCDNAuthToken(Session.AppId, depot, server.Host!).WaitAsync(Program.Cancel);
                        Session.Check(auth.Result, "CDN 授权失败"); tokens[server.Host!] = auth.Token;
                        // Retry this server with its host-specific token, then fail over if it still fails.
                        return await call(server, auth.Token).WaitAsync(Program.Cancel);
                    }
                } catch (Exception e) when (e is HttpRequestException or TaskCanceledException or SteamKitWebRequestException) {
                    last = e; await Task.Delay(500 * (attempt + 1), Program.Cancel);
                }
            }
            throw new SteamFailure("Steam CDN 下载失败（" + last?.GetType().Name + "），已完成的文件可在重试时复用。");
        }
        Program.Status("manifest", "正在获取 Steam 资源清单…");
        var manifest = await Download((s, t) => cdn.DownloadManifestAsync(depot, manifestId, requestCode, s, key, cdnAuthToken: t));
        if (manifest.ManifestGID != manifestId || manifest.DepotID != depot || manifest.FilenamesEncrypted || manifest.Files == null)
            throw new InvalidDataException("Steam 资源清单无法校验。");
        var files = manifest.Files.Where(f => !f.Flags.HasFlag(EDepotFileFlag.Directory)).ToList();
        if (files.Any(f => f.Flags.HasFlag(EDepotFileFlag.Symlink))) throw new InvalidDataException("资源清单包含不支持的符号链接。");
        // Use a sibling on the same filesystem, identified by manifest. Publish with a single directory rename.
        var stage = destination + ".download-" + manifestId;
        Directory.CreateDirectory(stage);
        var total = files.Sum(f => checked((long)f.TotalSize));
        long done = 0;
        // Separate verified cache hits, useful payload, and compressed CDN bytes.
        // The UI must not report reused files as network throughput on a retry.
        long downloadedBytes = 0, transferredBytes = 0;
        void Progress(string file) => Program.Status("downloading", file, done, total,
            downloadedBytes: downloadedBytes, transferredBytes: transferredBytes);
        Progress("");
        foreach (var file in files)
        {
            Program.Cancel.ThrowIfCancellationRequested();
            var path = SafeFiles.Under(stage, file.FileName);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            if (File.Exists(path) && new FileInfo(path).Length == (long)file.TotalSize && SafeFiles.Hash(path) == Convert.ToHexString(file.FileHash)) {
                done += (long)file.TotalSize; Progress(file.FileName); continue;
            }
            var temp = path + ".celemod-part";
            using (var output = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None)) {
                output.SetLength(checked((long)file.TotalSize));
                foreach (var chunk in file.Chunks.OrderBy(c => c.Offset)) {
                    if (chunk.UncompressedLength > 16 * 1024 * 1024 || chunk.Offset + chunk.UncompressedLength > file.TotalSize)
                        throw new InvalidDataException("无效的 Steam 资源块。");
                    var buffer = new byte[chunk.UncompressedLength];
                    var count = await Download((s, t) => cdn.DownloadDepotChunkAsync(depot, chunk, s, buffer, key, cdnAuthToken: t));
                    if (count != chunk.UncompressedLength) throw new InvalidDataException("Steam 资源块长度不匹配。");
                    output.Position = checked((long)chunk.Offset);
                    await output.WriteAsync(buffer.AsMemory(0, count), Program.Cancel);
                    done += count;
                    downloadedBytes += count;
                    transferredBytes += chunk.CompressedLength;
                    Progress(file.FileName);
                }
                output.Flush(true);
            }
            SafeFiles.Verify(temp, file.FileHash, checked((long)file.TotalSize));
            SafeFiles.Replace(temp, path);
        }
        var executable = SafeFiles.Under(stage, "Celeste.exe");
        if (!File.Exists(executable) || !File.Exists(SafeFiles.Under(stage, "FNA.dll")) || !Directory.Exists(SafeFiles.Under(stage, "Content")))
            throw new InvalidDataException("下载的 Celeste 不是此 Android 运行时支持的 FNA 版本。");
        using (var stream = File.OpenRead(executable)) using (var pe = new PEReader(stream)) {
            if (pe.PEHeaders.CorHeader is not { } header || !header.Flags.HasFlag(CorFlags.ILOnly))
                throw new InvalidDataException("此游戏构建含原生包装器或 DRM，Android 无法直接运行；未修改或移除 DRM。");
        }
        Program.Cancel.ThrowIfCancellationRequested();
        // Informational receipt is not an ownership bypass. Authorization above is required for every download.
        Program.Write(Path.Combine(stage, ".celemod-steam.json"), new { appId = Session.AppId, steamId = session.SteamId, depot, manifest = manifestId.ToString() });
        Program.Write(Path.Combine(state, "install.json"), new { steamId = session.SteamId, game = destination, depot, manifest = manifestId.ToString() });
        Directory.Move(stage, destination);
        Program.Status("downloaded", "Steam 资源下载完成。请先安装 Android 兼容的 Everest，再启动游戏。", total, total);
    }
}
