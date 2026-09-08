using System.Text.Json.Nodes;
using SteamKit2;
using SteamKit2.Authentication;
using SteamKit2.Internal;

namespace CeleMod.Steam;

internal sealed class SteamFailure(string message) : Exception(message);

internal sealed class Session : IDisposable, IAuthenticator
{
    internal const uint AppId = 504230;
    internal readonly SteamClient Client = new(SteamConfiguration.Create(b => b.WithProtocolTypes(ProtocolTypes.WebSocket)));
    internal SteamApps Apps => Client.GetHandler<SteamApps>()!;
    internal SteamContent Content => Client.GetHandler<SteamContent>()!;
    internal Cloud Cloud => Client.GetHandler<SteamUnifiedMessages>()!.CreateService<Cloud>();
    internal string Account = "";
    internal string Token = "";
    internal ulong ClientId;
    internal string SteamId => Client.SteamID?.ConvertToUInt64().ToString() ?? throw new SteamFailure("Steam 会话已断开，请重试登录。");
    private readonly CancellationTokenSource stop = new();
    private Task? pump;
    private KeyValue? info;
    private bool preferGuardCode;

    internal static void Check(EResult result, string operation) {
        if (result != EResult.OK) throw new SteamFailure($"{operation}: Steam {result}");
    }

    internal async Task Login(JsonObject request)
    {
        Account = request["account"]?.GetValue<string>() ?? "";
        Token = request["token"]?.GetValue<string>() ?? "";
        preferGuardCode = request["useGuardCode"]?.GetValue<bool>() ?? false;
        ulong.TryParse(request["clientId"]?.GetValue<string>(), out ClientId);
        var manager = new CallbackManager(Client);
        var connected = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var loggedIn = new TaskCompletionSource<SteamUser.LoggedOnCallback>(TaskCreationOptions.RunContinuationsAsynchronously);
        manager.Subscribe<SteamClient.ConnectedCallback>(_ => connected.TrySetResult());
        manager.Subscribe<SteamUser.LoggedOnCallback>(r => loggedIn.TrySetResult(r));
        manager.Subscribe<SteamClient.DisconnectedCallback>(_ => {
            var error = new SteamFailure("Steam 连接中断，请检查网络后重试。");
            connected.TrySetException(error); loggedIn.TrySetException(error);
        });
        pump = Task.Run(() => { while (!stop.IsCancellationRequested) manager.RunWaitCallbacks(TimeSpan.FromMilliseconds(100)); });
        Program.Status("connecting", "正在连接 Steam…");
        Client.Connect();
        await connected.Task.WaitAsync(TimeSpan.FromSeconds(40), Program.Cancel);
        if (request["action"]?.GetValue<string>() == "probe") {
            Client.GetHandler<SteamUser>()!.LogOnAnonymous();
            Check((await loggedIn.Task.WaitAsync(TimeSpan.FromSeconds(45), Program.Cancel)).Result, "Steam 连接检查");
            return;
        }
        if (Token.Length == 0)
        {
            Program.Status("authenticating", "正在验证 Steam 账号…");
            var auth = await Client.Authentication.BeginAuthSessionViaCredentialsAsync(new AuthSessionDetails {
                Username = Account, Password = request["password"]!.GetValue<string>(),
                DeviceFriendlyName = "CeleMod Android", IsPersistentSession = true, Authenticator = this
            }).WaitAsync(TimeSpan.FromSeconds(45), Program.Cancel);
            request.Remove("password");
            var result = await auth.PollingWaitForResultAsync(Program.Cancel).WaitAsync(TimeSpan.FromMinutes(5), Program.Cancel);
            Account = result.AccountName;
            Token = result.RefreshToken;
            ClientId = auth.ClientID;
        }
        Client.GetHandler<SteamUser>()!.LogOn(new SteamUser.LogOnDetails {
            Username = Account, AccessToken = Token, ShouldRememberPassword = true,
            LoginID = 0x43454c45 // Stable, distinct from the desktop Steam client.
        });
        Check((await loggedIn.Task.WaitAsync(TimeSpan.FromSeconds(45), Program.Cancel)).Result, "登录失败");
    }

    internal async Task<KeyValue> AppInfo()
    {
        if (info != null) return info;
        var tokens = await Apps.PICSGetAccessTokens([AppId], []).ToTask().WaitAsync(Program.Cancel);
        tokens.AppTokens.TryGetValue(AppId, out var token);
        var response = await Apps.PICSGetProductInfo([new SteamApps.PICSRequest(AppId, token)], []).ToTask().WaitAsync(Program.Cancel);
        info = response.Results?.SelectMany(x => x.Apps).FirstOrDefault(x => x.Key == AppId).Value?.KeyValues;
        return info ?? throw new SteamFailure("Steam 未返回 Celeste 产品信息。");
    }

    internal async Task<(uint depot, ulong manifest, byte[] key)> OwnedDepot()
    {
        var app = await AppInfo();
        var depots = app["depots"].Children.Where(d => uint.TryParse(d.Name, out _) &&
            d["config"]["oslist"].AsString() == "linux" && !d["depotfromapp"].AsUnsignedInteger().Equals(228980u)).ToList();
        if (depots.Count != 1) throw new SteamFailure("Celeste Linux depot 配置已变化，暂不支持此版本。");
        var depot = uint.Parse(depots[0].Name!);
        var manifest = depots[0]["manifests"]["public"]["gid"].AsUnsignedLong();
        if (manifest == 0) throw new SteamFailure("Steam 未返回公开版本的资源清单。");
        // The server grants keys only for entitled depots. Never use anonymous keys or bypass subscriptions.
        var key = await Apps.GetDepotDecryptionKey(depot, AppId).ToTask().WaitAsync(Program.Cancel);
        Check(key.Result, "账号需要拥有 Celeste 的有效下载权限");
        if (key.DepotKey is not { Length: 32 }) throw new SteamFailure("Steam 返回了无效的 depot 密钥。");
        return (depot, manifest, key.DepotKey);
    }

    private async Task<string> Guard(string kind, bool incorrect)
    {
        File.Delete(Path.Combine(Program.Ipc, "guard.json"));
        Program.Status(kind, incorrect ? "验证码不正确，请重新输入。" : "请输入 Steam Guard 验证码。");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(Program.Cancel);
        timeout.CancelAfter(TimeSpan.FromMinutes(5));
        var file = Path.Combine(Program.Ipc, "guard.json");
        while (!File.Exists(file)) await Task.Delay(150, timeout.Token);
        var code = JsonNode.Parse(await File.ReadAllTextAsync(file, timeout.Token))!["code"]!.GetValue<string>();
        File.Delete(file);
        return code;
    }
    public Task<string> GetDeviceCodeAsync(bool previousCodeWasIncorrect) => Guard("guard-device", previousCodeWasIncorrect);
    public Task<string> GetEmailCodeAsync(string email, bool previousCodeWasIncorrect) => Guard("guard-email", previousCodeWasIncorrect);
    public Task<bool> AcceptDeviceConfirmationAsync() {
        if (preferGuardCode) return Task.FromResult(false);
        Program.Status("guard-confirm", "请在 Steam 手机应用中确认此次登录；也可取消后勾选验证码登录。");
        return Task.FromResult(true);
    }
    public void Dispose() { Client.Disconnect(); stop.Cancel(); pump?.GetAwaiter().GetResult(); stop.Dispose(); Token = ""; }
}
