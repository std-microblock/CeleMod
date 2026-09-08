using System.Text.Json;
using System.Text.Json.Nodes;

namespace CeleMod.Steam;

// Private-files IPC only: no listening socket, Web API key, command-line credentials or console logging.
internal static class Program
{
    internal static string Ipc = "";
    internal static string Job = "";
    internal static CancellationToken Cancel;
    internal static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    internal static void Write(string path, object value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(value, Json));
        File.Move(path + ".tmp", path, true);
    }

    internal static void Status(string stage, string message, long done = 0, long total = 0, object? conflicts = null) =>
        Write(Path.Combine(Ipc, "status.json"), new { job = Job, revision = Guid.NewGuid().ToString("N"), stage, message, done, total, conflicts });

    public static async Task Main(string[] args)
    {
        if (args.Length != 1 || !Path.IsPathFullyQualified(args[0])) return;
        Ipc = args[0];
        Directory.CreateDirectory(Ipc);
        Write(Path.Combine(Ipc, "ready.json"), new { ready = true });
        while (true)
        {
            var requestPath = Path.Combine(Ipc, "request.json");
            if (!File.Exists(requestPath)) { await Task.Delay(100); continue; }
            JsonObject request;
            try { request = JsonNode.Parse(await File.ReadAllTextAsync(requestPath))!.AsObject(); }
            finally { File.Delete(requestPath); }
            Job = request["job"]!.GetValue<string>();
            using var cancellation = new CancellationTokenSource(TimeSpan.FromMinutes(90));
            Cancel = cancellation.Token;
            var watch = Task.Run(async () => {
                while (!cancellation.IsCancellationRequested) {
                    if (File.Exists(Path.Combine(Ipc, "cancel"))) { cancellation.Cancel(); break; }
                    await Task.Delay(200);
                }
            });
            object completion;
            Action<string, string>? diagnostic = null;
            if (request["action"]?.GetValue<string>() == "probe") {
                // Anonymous diagnostics only. Authenticated operations NEVER enable SteamKit protocol logging.
                File.WriteAllText(Path.Combine(Ipc, "probe.log"), "");
                diagnostic = (category, message) => {
                    lock (Json) File.AppendAllText(Path.Combine(Ipc, "probe.log"), category + ": " + message + "\n");
                };
                SteamKit2.DebugLog.AddListener(diagnostic); SteamKit2.DebugLog.Enabled = true;
            }
            try
            {
                using var session = new Session();
                await session.Login(request);
                var action = request["action"]!.GetValue<string>();
                object result;
                if (action == "probe") {
                    var app = await session.AppInfo();
                    if (app["common"]["name"].AsString() != "Celeste") throw new SteamFailure("Steam 产品信息检查失败。");
                    result = new { reachable = true, appId = Session.AppId };
                } else if (action == "login") {
                    await session.AppInfo(); // Obtain authoritative app metadata from Steam, not a metadata proxy.
                    result = new { account = session.Account, steamId = session.SteamId, token = session.Token, clientId = session.ClientId.ToString() };
                } else {
                    var game = request["game"]!.GetValue<string>();
                    var state = request["state"]!.GetValue<string>();
                    if (action == "download") {
                        await new DepotDownload(session).Run(game, state);
                    } else if (action == "sync") {
                        await new CloudSync(session, game, state).Run(request["choice"]?.GetValue<string>(), request["phase"]?.GetValue<string>() ?? "manual");
                    } else throw new InvalidOperationException("Unknown Steam operation");
                    result = new { account = session.Account, steamId = session.SteamId, game };
                }
                Status("complete", "操作完成");
                completion = new { job = Job, ok = true, result };
            }
            catch (CloudConflictException e) {
                Status("conflict", "本地和 Steam 云存档都有变化，请选择保留的版本。", conflicts: e.Files);
                completion = new { job = Job, ok = false, error = "云存档冲突", conflict = true };
            }
            catch (Exception e) {
                // Do not serialize exception stacks/URLs: CDN URLs can carry signed credentials.
                var message = e is OperationCanceledException ? "操作已取消或超时，可重试；未同步的存档会保留。" :
                    e is SteamKit2.Authentication.AuthenticationException authError ? "Steam 验证失败：" + authError.Result + "。请检查账号、密码或 Steam Guard 后重试。" :
                    e is SteamFailure or InvalidDataException or InvalidOperationException ? e.Message :
                    "Steam 操作失败（" + e.GetType().Name + "），请检查网络、可用空间和登录状态后重试。";
                Status("error", message);
                completion = new { job = Job, ok = false, error = message };
            }
            finally {
                request.Clear();
                cancellation.Cancel();
                await watch;
                File.Delete(Path.Combine(Ipc, "guard.json"));
                File.Delete(Path.Combine(Ipc, "cancel"));
                if (diagnostic != null) { SteamKit2.DebugLog.Enabled = false; SteamKit2.DebugLog.RemoveListener(diagnostic); }
            }
            // Publish completion LAST, after teardown. The next command cannot race old cancellation/guard cleanup.
            Write(Path.Combine(Ipc, "result.json"), completion);
        }
    }
}
