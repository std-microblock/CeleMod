import type { SteamStatus } from "./steamState";

/** Visible immediately, even before the first native status response arrives. */
export function SteamLaunchProgress({ status }: { status?: SteamStatus }) {
  const stage = status?.launchStage;
  const syncing = stage === "waiting-sync" || stage === "syncing" ||
    (!stage && status?.busy && status.operation === "sync");
  const title = syncing ? "正在等待 Steam 云存档同步…"
    : stage === "starting" ? "正在进入游戏…" : "正在准备游戏运行时…";
  return <div className="steam-callout steam-launch-progress" role="status" aria-live="polite">
    <strong><span className="steam-spinner" aria-hidden="true" />{title}</strong>
    <p>{syncing ? "同步完成并校验通过后自动进入游戏，不会跳过云存档。"
      : "正在准备启动，启用云存档时会先完成同步。"}</p>
    <p>可以收起面板继续使用管理器，再从 Steam 入口查看进度。</p>
  </div>;
}
