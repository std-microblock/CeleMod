import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGamePath } from "../states";
import { useGlobalContext } from "../App";
import { Icon } from "./Icon";
import "./SteamAccount.scss";

type SteamStatus = {
  account: string; steamId: string; busy: boolean; cloud: boolean; offline: boolean;
  pending: boolean; stage?: string; message?: string; done?: number; total?: number;
  conflicts?: { name: string; local: string | null; remote: string | null }[];
  game?: string;
};
const command = (request: Record<string, unknown>) => invoke<SteamStatus>("android_steam", { request });

/** Shown on Android Home as well as Settings, so first install and post-game cloud failures are discoverable. */
export function SteamAccount() {
  const [status, setStatus] = useState<SteamStatus>();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useGuardCode, setUseGuardCode] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [gamePath, setGamePath] = useGamePath();
  const ctx = useGlobalContext();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await command({ action: "status" }); if (!stopped) setStatus(next); }
      catch (e) { if (!stopped) setError(String(e)); }
      finally { if (!stopped) timer = setTimeout(() => void poll(), 1500); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  async function act(action: string, fields: Record<string, unknown> = {}) {
    setSending(true); setError("");
    try { setStatus(await command({ action, ...fields })); }
    catch (e) { setError(String(e)); }
    finally { setSending(false); }
  }
  const busy = sending || status?.busy;
  const guarded = status?.stage === "guard-device" || status?.stage === "guard-email";
  const currentGame = status?.game || gamePath;
  return <section className="steam-account" aria-label="Steam 账号与云存档">
    <header><Icon name="download" /><strong>Steam · Celeste</strong>
      <span>{status?.account || "登录后直接下载已购买的游戏"}</span></header>
    {!status?.account && <form onSubmit={e => {
      e.preventDefault(); const secret = password; setPassword("");
      void act("login", { account: account.trim(), password: secret, useGuardCode });
    }}>
      <label>Steam 账号<input autoComplete="username" autoCapitalize="none" spellCheck={false}
        value={account} onChange={e => setAccount(e.target.value)} disabled={busy} /></label>
      <label>密码<input type="password" autoComplete="current-password" value={password}
        onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
      <button className="primary" type="submit" disabled={busy || !account.trim() || !password}>登录 Steam</button>
      <button type="button" disabled={busy} onClick={() => void act("probe")}>检查 Steam 连接</button>
      <label className="steam-guard-option"><input type="checkbox" checked={useGuardCode} disabled={busy}
        onChange={e => setUseGuardCode(e.target.checked)} />优先使用验证码，不使用手机确认</label>
      <small>仅直接连接 Steam。密码不保存；登录令牌由 Android Keystore 加密保存。支持 Steam Guard 验证。</small>
    </form>}
    {guarded && <form onSubmit={e => { e.preventDefault(); void act("guard", { code }); setCode(""); }}>
      <label>{status.stage === "guard-email" ? "邮件验证码" : "Steam Guard 验证码"}
        <input autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} maxLength={8} /></label>
      <button type="submit" disabled={sending || !code.trim()}>提交验证码</button>
    </form>}
    {status?.account && <div className="steam-actions">
      <button className="primary" disabled={busy} onClick={() => {
        if (window.confirm("从 Steam 下载 Celeste（约 1.2 GB，需额外空间安装 Everest）。只下载到独立新目录，不覆盖现有游戏。继续？")) void act("download");
      }}>从 Steam 下载游戏</button>
      <button disabled={busy || !currentGame} onClick={() => void act("sync", { game: currentGame })}>立即同步 / 重试</button>
      <button disabled={busy} onClick={() => {
        if (window.confirm("退出 Steam？本地游戏与未上传存档会保留，重新登录原账号后可继续同步。")) void act("logout");
      }}>退出账号</button>
    </div>}
    <div className="steam-toggles">
      <label><input type="checkbox" checked={status?.cloud ?? true} disabled={!status || busy}
        onChange={e => {
          if (!e.target.checked && !window.confirm("关闭自动云同步后，本地进度不会自动上传到 Steam。继续？")) return;
          void act("settings", { cloud: e.target.checked });
        }} />自动 Steam 云存档（启动前 / 退出后）</label>
      <label><input type="checkbox" checked={status?.offline ?? false} disabled={!status || busy}
        onChange={e => void act("settings", { offline: e.target.checked })} />离线游玩，联网后再同步</label>
    </div>
    <div className="steam-status" role={status?.stage === "error" || status?.stage === "conflict" ? "alert" : "status"} aria-live="polite">
      <span>{status?.message || "需要拥有 Celeste 的 Steam 账号。ZIP 导入仍可继续使用。"}</span>
      {status?.busy && !!status.total && <><progress max={status.total} value={status.done ?? 0} />
        <small>{Math.floor((status.done ?? 0) / 1048576)} / {Math.ceil(status.total / 1048576)} MiB</small></>}
      {status?.pending && <small>有待同步的游戏存档。离线、失败或冲突时不会标记为已同步。</small>}
      {status?.offline && <small>当前为离线模式，不会访问 Steam 云端；关闭后自动重试待同步存档。</small>}
      {busy && <button disabled={sending} onClick={() => void act("cancel")}>取消当前操作</button>}
    </div>
    {status?.stage === "conflict" && <div className="steam-conflict">
      <strong>存档冲突：自动同步已暂停</strong>
      <ul>{status.conflicts?.map(f => <li key={f.name}>{f.name}（手机：{f.local ? "已修改" : "已删除"}，云端：{f.remote ? "已修改" : "已删除"}）</li>)}</ul>
      <small>继续前会备份两端版本；若选择期间文件再次改变，将重新要求确认。</small>
      <div className="steam-actions">
        <button disabled={busy || !currentGame} onClick={() => {
          if (window.confirm("使用手机版本解决当前冲突并上传到 Steam？云端旧版本会先备份。")) void act("resolve", { game: currentGame, choice: "local" });
        }}>保留手机版本</button>
        <button disabled={busy || !currentGame} onClick={() => {
          if (window.confirm("使用 Steam 云端版本解决当前冲突？手机旧版本会先备份。")) void act("resolve", { game: currentGame, choice: "cloud" });
        }}>使用 Steam 云端版本</button>
      </div>
    </div>}
    {status?.game && <div className="steam-actions">
      <button disabled={busy} onClick={() => { setGamePath(status.game!); ctx.pageController.setPage("Everest"); }}>选择已下载游戏并安装 Everest</button>
    </div>}
    <small>下载完成后先安装 Everest。桌面 Steam 的原生 DRM / Overlay 不在 Android 中模拟；不提供 DRM 破解。云同步只处理 Steam 配置的 Saves/*.celeste，不上传 Mods。</small>
    {error && <p role="alert">{error}</p>}
  </section>;
}
