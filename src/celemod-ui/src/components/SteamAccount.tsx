import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaSteam } from "react-icons/fa";
import { invoke } from "@tauri-apps/api/core";
import { useGamePath } from "../states";
import { useGlobalContext } from "../App";
import { Icon } from "./Icon";
import { steamActivity, steamIssue, steamProgress, steamScreen, type SteamPanel, type SteamStatus } from "./steamState";
import "./SteamAccount.scss";

const command = (request: Record<string, unknown>) => invoke<SteamStatus>("android_steam", { request });

/** Compact Home/Settings entry. Sensitive forms only live in an open native dialog. */
export function SteamAccount() {
  const [status, setStatus] = useState<SteamStatus>();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [useGuardCode, setUseGuardCode] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [guardSubmitted, setGuardSubmitted] = useState("");
  const [panel, setPanel] = useState<SteamPanel>("main");
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  const requestVersion = useRef(0);
  const inFlight = useRef(false);
  const [gamePath, setGamePath] = useGamePath();
  const ctx = useGlobalContext();
  const id = useId();
  const screen = steamScreen(status, panel);
  const busy = sending || !!status?.busy;
  const percent = steamProgress(status);
  const guardRevision = `${status?.job}:${status?.revision}:${status?.stage}:${status?.message}`;
  const waitingForCode = !!guardSubmitted && guardSubmitted === guardRevision;

  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const version = requestVersion.current;
      try {
        if (!inFlight.current) {
          const next = await command({ action: "status" });
          if (!stopped && version === requestVersion.current && !inFlight.current) {
            setStatus(next); setConnectionError("");
          }
        }
      } catch (e) { if (!stopped && version === requestVersion.current) setConnectionError(String(e)); }
      finally { if (!stopped) timer = setTimeout(() => void poll(), 1000); }
    };
    void poll();
    return () => { stopped = true; alive.current = false; clearTimeout(timer); };
  }, []);
  useEffect(() => { if (!status?.busy) { setCanceling(false); setGuardSubmitted(""); } }, [status?.busy]);
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      // Opening the sheet should not immediately summon the keyboard.
      heading.current?.focus({ preventScroll: true });
      dialog.current?.scrollTo(0, 0);
    }
  }, [open, screen]);
  useEffect(() => {
    if (!open || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const resize = () => {
      dialog.current?.style.setProperty("--steam-viewport", `${viewport.height}px`);
      dialog.current?.style.setProperty("--steam-viewport-top", `${viewport.offsetTop}px`);
    };
    resize(); viewport.addEventListener("resize", resize); viewport.addEventListener("scroll", resize);
    return () => { viewport.removeEventListener("resize", resize); viewport.removeEventListener("scroll", resize); };
  }, [open]);

  async function act(action: string, fields: Record<string, unknown> = {}) {
    if (inFlight.current) return false;
    inFlight.current = true; ++requestVersion.current;
    setSending(true); setError(""); setNotice("");
    try {
      const next = await command({ action, ...fields });
      if (!alive.current) return false;
      setStatus(next); setConnectionError("");
      return true;
    } catch (e) { if (alive.current) setError(String(e)); return false; }
    finally { inFlight.current = false; if (alive.current) setSending(false); }
  }
  function close() { dialog.current?.close(); }
  function closed() {
    setOpen(false); setPassword(""); setCode(""); setShowPassword(false);
    setPanel("main"); setError(""); setNotice("");
    opener.current?.focus({ preventScroll: true });
  }
  function navigate(next: SteamPanel) { setPanel(next); setError(""); setNotice(""); }
  async function start(action: string, fields: Record<string, unknown> = {}) {
    if (await act(action, fields)) setPanel("main");
  }
  async function cancel() {
    setCanceling(true);
    if (!await act("cancel")) setCanceling(false);
  }
  function selectGame() {
    if (!status?.game) return;
    close(); setGamePath(status.game); ctx.pageController.setPage("Everest");
  }

  const problem = error || connectionError || (!status?.busy && status?.stage === "error" ? status.message || "Steam 操作失败" : "");
  const issue = problem ? steamIssue(problem) : undefined;
  const activity = steamActivity(status);
  const cloudLabel = status?.offline ? "离线游玩" : !status?.cloud ? "自动同步已关闭" : status?.pending ? "存档等待同步" : "自动云存档已开启";
  const summary = !status ? connectionError ? "连接暂不可用 · 查看详情" : "正在读取账号状态…"
    : status.busy ? `${activity}${percent === undefined ? "" : ` · ${percent}%`}`
    : status.stage === "conflict" ? "存档冲突 · 需要选择版本"
    : problem ? `${issue?.title} · 查看详情`
    : status.stage === "interrupted" ? "上次操作中断 · 点此继续"
    : status.account ? cloudLabel : "登录后下载 Celeste，自动同步存档";
  const titles: Record<string, string> = {
    loading: "正在读取 Steam 状态", login: "登录 Steam", approval: "确认是你本人", code: "输入验证码",
    progress: activity, overview: "你的 Celeste", download: "下载 Celeste", settings: "账号与云存档",
    conflict: "选择要保留的进度", local: "保留手机上的进度？", cloud: "使用 Steam 云端进度？",
    logout: "退出 Steam？", "disable-cloud": "关闭自动云存档？",
  };
  const canGoBack = !status?.busy && panel !== "main";
  const support = <details className="steam-help"><summary>登录与兼容性说明</summary>
    <p>使用 Steam 登录账号（不是昵称）。支持手机确认、令牌和邮件验证码，暂不支持扫码登录。</p>
    <p>密码不保存；登录令牌由 Android Keystore 加密保存在本机。账号信息仅用于直接连接 Steam。</p>
    <p>需要拥有 Celeste 的下载权限。下载后需安装 Everest；Android 不模拟桌面 Steam DRM 或 Overlay，遇到不兼容版本会停止安装。ZIP 导入仍可使用。</p>
    <button type="button" disabled={busy} onClick={() => void start("probe")}>检查 Steam 连接</button>
  </details>;

  return <>
    <button ref={opener} type="button" className="steam-entry" aria-haspopup="dialog" aria-controls={`${id}-dialog`}
      onClick={() => { setPanel("main"); setOpen(true); }}>
      <span className="steam-mark"><FaSteam aria-hidden="true" /></span>
      <span className="steam-entry-copy"><strong>{status?.account ? `Steam · ${status.account}` : "从 Steam 获取游戏"}</strong><span>{summary}</span></span>
      <Icon name="i-right" />
    </button>
    {createPortal(<dialog ref={dialog} id={`${id}-dialog`} className="steam-sheet" aria-labelledby={`${id}-title`}
      onCancel={e => { if (canGoBack) { e.preventDefault(); navigate("main"); } }}
      onClose={closed} onClick={e => { if (e.target === e.currentTarget) {
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
      } }}>
      {open && <div className="steam-sheet-inner" data-steam-screen={screen}>
        <header className="steam-toolbar">
          {canGoBack ? <button type="button" className="steam-icon-button" aria-label="返回" onClick={() => navigate("main")}><span className="steam-back"><Icon name="i-right" /></span></button> : <FaSteam aria-hidden="true" />}
          <span>STEAM <span className="steam-toolbar-divider">/</span> CELEMOD</span>
          <button type="button" className="steam-icon-button" aria-label="关闭 Steam 面板" onClick={close}><Icon name="i-cross" /></button>
        </header>
        <div className="steam-body">
          <div className="steam-heading"><span className="steam-eyebrow">{screen === "login" ? "连接你的游戏库" : screen === "code" || screen === "approval" ? "STEAM GUARD · 安全验证" : "CELESTE / 蔚蓝"}</span>
            <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>{titles[screen]}</h2></div>
          {issue && <div className="steam-callout steam-error" role="alert"><strong>{issue.title}</strong><p>{issue.hint}</p>
            <details><summary>查看具体原因</summary><p className="steam-technical">{problem}</p></details>
            {status?.account && !status.busy && screen !== "login" && <button type="button" onClick={() => { setAccount(status.account); navigate("login"); }}>重新登录</button>}
            {status?.operation === "download" && status.account && !busy && screen === "overview" && <button type="button" onClick={() => navigate("download")}>重试下载</button>}
          </div>}
          {notice && <p className="steam-callout" role="status">{notice}</p>}
          {status?.pendingOtherAccount && !status.busy && <p className="steam-callout">另一个 Steam 账号还有待同步存档。请先切回原账号完成同步，避免混用进度。</p>}
          {status?.stage === "interrupted" && !status.busy && <p className="steam-callout">上次操作被中断。游戏和未同步存档已保留，可以重新尝试。</p>}
          {status?.stage === "cancelled" && !status.busy && <p className="steam-muted" role="status">已取消。本地游戏和存档未被删除。</p>}
          {status?.operation === "probe" && status.stage === "complete" && !status.busy && <p className="steam-callout" role="status">Steam 连接正常。</p>}
          {screen === "loading" && <p className="steam-muted" role="status">{connectionError ? "暂时无法读取状态，将自动重试。" : "正在读取本机的 Steam 登录信息…"}</p>}
          {screen === "login" && <>
            <p className="steam-intro">登录已拥有 Celeste 的账号，直接下载游戏，无需再导入 ZIP。</p>
            <form className="steam-form" onSubmit={e => {
              e.preventDefault(); const secret = password; setPassword(""); setShowPassword(false);
              void start("login", { account: account.trim(), password: secret, useGuardCode });
            }}>
              <label htmlFor={`${id}-account`}>Steam 登录账号</label>
              <input id={`${id}-account`} name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                placeholder="不是个人资料昵称" value={account} onChange={e => setAccount(e.target.value)} disabled={busy} required />
              <label htmlFor={`${id}-password`}>密码</label>
              <div className="steam-password"><input id={`${id}-password`} name="password" type={showPassword ? "text" : "password"}
                autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} required />
                <button type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}><Icon name="eye" /></button></div>
              <details className="steam-help"><summary>验证方式：{useGuardCode ? "输入验证码" : "优先手机确认"}</summary>
                <label className="steam-check"><input type="checkbox" checked={useGuardCode} onChange={e => setUseGuardCode(e.target.checked)} disabled={busy} />使用 Steam Guard 验证码登录</label>
                <p>没有 Steam 手机应用？可改用验证码；邮件验证由 Steam 按账号设置提供。</p>
              </details>
              <button className="steam-primary" type="submit" disabled={busy || !account.trim() || !password}>{sending ? "正在登录…" : "登录 Steam"}<Icon name="i-right" /></button>
            </form>
            <p className="steam-footnote">密码不保存 · 仅直接连接 Steam</p>
            {status?.account && <button type="button" className="steam-text-button" disabled={busy} onClick={() => navigate("settings")}>返回账号设置</button>}
            {support}
          </>}
          {(screen === "approval" || screen === "code") && <>
            <div className="steam-verification"><Icon name={screen === "approval" ? "clock" : "keyboard"} /></div>
            {screen === "approval" ? <>
              <p className="steam-intro">打开 Steam 手机应用，批准来自 <strong>CeleMod Android</strong> 的登录请求。</p>
              <div className="steam-wait" role="status"><span className="steam-spinner" />等待确认，完成后会自动继续</div>
              <button type="button" disabled={sending || canceling} onClick={async () => {
                setUseGuardCode(true); await cancel(); setPanel("login");
                setNotice("当前登录取消后，请重新输入密码，并使用 Steam Guard 验证码登录。");
              }}>改用验证码登录</button>
            </> : <form className="steam-form" onSubmit={async e => {
              e.preventDefault(); const value = code; setCode(""); setGuardSubmitted(guardRevision);
              if (!await act("guard", { code: value })) setGuardSubmitted("");
            }}>
              <p className="steam-intro">{status?.stage === "guard-email" ? "请查看 Steam 发来的验证邮件，输入其中的验证码。" : "打开 Steam 手机应用中的「Steam 令牌」，输入当前验证码。"}</p>
              {status?.message?.includes("不正确") && <p role="alert" className="steam-inline-error">验证码不正确，请输入新的验证码。</p>}
              <label htmlFor={`${id}-code`}>{status?.stage === "guard-email" ? "邮件验证码" : "Steam Guard 验证码"}</label>
              <input id={`${id}-code`} className="steam-code" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false}
                maxLength={8} placeholder="输入验证码" value={code} disabled={sending || waitingForCode || canceling}
                onChange={e => setCode(e.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase())} />
              <button type="submit" className="steam-primary" disabled={sending || waitingForCode || canceling || !/^[A-Z0-9]{5,8}$/.test(code)}>{waitingForCode ? "正在验证…" : "验证并继续"}</button>
              <p className="steam-footnote">{status?.stage === "guard-email" ? "没收到？检查垃圾邮件，或取消后重新登录。" : "验证码会定期更新，请使用当前显示的一组。"}</p>
            </form>}
            <button type="button" className="steam-text-button" disabled={sending || canceling} onClick={() => void cancel()}>{canceling ? "正在取消…" : "取消登录"}</button>
          </>}
          {screen === "progress" && <>
            <div className="steam-transfer-art"><FaSteam aria-hidden="true" /><span className="steam-spinner" /></div>
            <p className="steam-intro">{status?.stage === "syncing" ? "正在比较并同步手机与 Steam 云端的进度。" : status?.operation === "download" ? "正在获取你已购买的游戏资源，请保持网络连接。" : status?.operation === "probe" ? "只检查与 Steam 的连接，不会登录你的账号。" : "正在与 Steam 建立安全连接，请稍候。"}</p>
            <div className="steam-progress" role="status"><div><span>{activity}</span>{percent !== undefined && <strong>{percent}%</strong>}</div>
              <progress aria-label={activity} max={100} value={percent} />
              {status?.stage === "downloading" && !!status.total && <small>{Math.floor((status.done ?? 0) / 1048576)} / {Math.ceil(status.total / 1048576)} MiB</small>}
            </div>
            <button type="button" className="steam-primary" onClick={close}>收起面板</button>
            <p className="steam-footnote">收起不会取消操作，可从 Steam 入口查看进度。</p>
            <button type="button" className="steam-text-button" disabled={sending || canceling} onClick={() => void cancel()}>{canceling ? "正在取消，请稍候…" : "取消当前操作"}</button>
          </>}
          {screen === "overview" && <>
            <div className="steam-game-card"><div className="steam-mountain" aria-hidden="true">▲</div><div><strong>Celeste</strong><span>{status?.game ? "游戏文件已就绪" : "从你的 Steam 游戏库下载"}</span></div><span className="steam-tag">PC → 手机</span></div>
            {status?.game ? <><button type="button" className="steam-primary" disabled={busy} onClick={selectGame}>{gamePath === status.game ? "管理 Everest" : "下一步：安装 Everest"}<Icon name="i-right" /></button>
              <p className="steam-footnote">手机运行需要 Everest；已安装的游戏可直接从主页启动。</p></>
              : <button type="button" className="steam-primary" disabled={busy} onClick={() => navigate("download")}><Icon name="download" />下载游戏</button>}
            <section className="steam-cloud-card" aria-label="云存档状态"><div><Icon name={status?.pending ? "clock" : "save"} /><strong>{cloudLabel}</strong></div>
              <p>{status?.offline ? "当前只使用本机存档，关闭离线模式后再同步。" : !status?.cloud ? "进度只保存在手机上，不会自动上传。" : status?.pending ? "有本机进度尚未确认上传，联网后会自动重试。" : "启动前检查云端进度，退出游戏后自动上传。"}</p>
              {status?.game && <button type="button" disabled={busy || status.offline} onClick={() => void start("sync", { game: status.game })}>{status.pending || status.stage === "error" ? "重试同步" : "立即同步"}</button>}
              {(status?.offline || !status?.cloud) && <button type="button" disabled={busy} onClick={() => void act("settings", { offline: false, cloud: true })}>恢复自动同步</button>}
            </section>
            <button type="button" className="steam-settings-link" onClick={() => navigate("settings")}><span><Icon name="settings" />账号与云存档设置</span><Icon name="i-right" /></button>
          </>}
          {screen === "download" && <>
            <p className="steam-intro">使用 <strong>{status?.account}</strong> 的 Steam 下载权限获取游戏，不覆盖已有的 ZIP 导入目录。</p>
            <ol className="steam-steps"><li><span>1</span><div><strong>下载原版资源</strong><p>约 1.2 GB，建议使用 Wi-Fi，并预留额外安装空间。实际大小以 Steam 清单为准。</p></div></li>
              <li><span>2</span><div><strong>安装 Everest</strong><p>下载完成后继续安装手机运行所需的模组加载器。</p></div></li>
              <li><span>3</span><div><strong>接着上次的进度玩</strong><p>{status?.cloud && !status.offline ? "自动同步已开启，将先检查 Steam 云存档。" : "当前未开启自动同步，可稍后在云存档设置中启用。"}</p></div></li></ol>
            <button type="button" className="steam-primary" disabled={busy} onClick={() => void start("download")}><Icon name="download" />开始下载</button>
            {support}
          </>}
          {screen === "settings" && <>
            <div className="steam-profile"><FaSteam aria-hidden="true" /><div><strong>{status?.account}</strong><small>Steam ID · {status?.steamId}</small></div></div>
            <label className="steam-setting"><span><strong>自动云存档</strong><small>启动前读取云端，退出后上传进度</small></span><input type="checkbox" role="switch" checked={status?.cloud ?? true} disabled={busy}
              onChange={e => e.target.checked ? void act("settings", { cloud: true }) : navigate("disable-cloud")} /></label>
            <label className="steam-setting"><span><strong>离线游玩</strong><small>暂不连接云端，联网后再同步</small></span><input type="checkbox" role="switch" checked={status?.offline ?? false} disabled={busy}
              onChange={e => void act("settings", { offline: e.target.checked })} /></label>
            <p className="steam-footnote">仅同步游戏存档（Saves/*.celeste），不上传 Mods。关闭自动同步或开启离线模式后，电脑端不会收到手机的新进度。</p>
            {status?.game && <button type="button" disabled={busy} onClick={() => navigate("download")}>重新下载游戏资源</button>}
            <button type="button" disabled={busy} onClick={() => { setAccount(status?.account || ""); navigate("login"); }}>重新登录 / 切换账号</button>
            <button type="button" className="steam-text-button" disabled={busy} onClick={() => navigate("logout")}>退出账号</button>
          </>}
          {screen === "conflict" && <>
            <p className="steam-intro">手机和 Steam 云端都有变化，自动同步已暂停。选择你想继续游玩的那份进度。</p>
            <div className="steam-callout">继续前会备份两端版本，不会直接丢弃另一份存档。</div>
            <button type="button" className="steam-choice" disabled={busy || !status?.game} onClick={() => navigate("local")}><Icon name="save" /><span><strong>保留手机进度</strong><small>将手机上的冲突版本上传到 Steam</small></span><Icon name="i-right" /></button>
            <button type="button" className="steam-choice" disabled={busy || !status?.game} onClick={() => navigate("cloud")}><Icon name="download" /><span><strong>使用 Steam 云端进度</strong><small>将云端的冲突版本下载到手机</small></span><Icon name="i-right" /></button>
            <details className="steam-help"><summary>查看冲突文件（{status?.conflicts?.length ?? 0}）</summary><ul className="steam-conflict-files">{status?.conflicts?.map(f => <li key={f.name}><strong>{f.name}</strong><small>手机：{f.local ? "已修改" : "已删除"} · 云端：{f.remote ? "已修改" : "已删除"}</small></li>)}</ul></details>
            <p className="steam-footnote">不确定选哪份？可以先关闭面板；冲突解决前不会自动覆盖。</p>
            <button type="button" className="steam-text-button" onClick={() => navigate("settings")}>账号与云存档设置</button>
          </>}
          {(screen === "local" || screen === "cloud") && <>
            <p className="steam-intro">{screen === "local" ? "冲突文件将以手机版本为准，并同步到 Steam。手机上已删除的冲突文件也会从云端删除。" : "冲突文件将以 Steam 云端版本为准，并应用到手机。云端已删除的冲突文件也会从手机删除。"}</p>
            <p className="steam-callout">另一份版本会先备份。如果文件再次变化，会重新请求确认。</p>
            <button type="button" className="steam-primary" disabled={busy || !status?.game} onClick={() => void start("resolve", { game: status?.game, choice: screen })}>确认使用{screen === "local" ? "手机" : "云端"}版本</button>
            <button type="button" onClick={() => navigate("main")}>返回选择</button>
          </>}
          {(screen === "logout" || screen === "disable-cloud") && <>
            <p className="steam-intro">{screen === "logout" ? "本地游戏和存档会保留。未上传的进度需要重新登录原账号后才能继续同步。" : "新进度将只保存在手机上，不会自动同步到 Steam。之后可随时重新开启。"}</p>
            {status?.pending && <p className="steam-callout">你还有尚未完成同步的存档。</p>}
            <button type="button" className="steam-primary" disabled={busy} onClick={async () => {
              if (screen === "logout") { if (await act("logout")) { setAccount(""); navigate("main"); } }
              else if (await act("settings", { cloud: false })) navigate("settings");
            }}>{screen === "logout" ? "退出并保留本地数据" : "关闭自动同步"}</button>
            <button type="button" disabled={busy} onClick={() => navigate("settings")}>返回</button>
          </>}
        </div>
      </div>}
    </dialog>, document.body)}
  </>;
}
