import type { SteamStatus } from "./steamState";
import { steamProgress } from "./steamState";
import { steamEta, steamSpeed, type SteamDownloadRate } from "./steamDownload";

export function steamBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1048576).toFixed(1)} MiB`;
}

export function SteamSyncProgress({ status, rate = {}, compact = false }: { status: SteamStatus; rate?: SteamDownloadRate; compact?: boolean }) {
  const percent = steamProgress(status);
  const verifying = ["verify", "apply"].includes(status.syncPhase ?? "");
  if (compact) return <span className="steam-sync-progress steam-sync-compact" role="status" aria-live="polite">
    <progress className="steam-download-bar" aria-label="云存档同步进度" max={100} value={percent} />
    <span className="steam-sync-summary"><span>{status.total ? `${status.done ?? 0} / ${status.total} 文件` : "正在读取清单…"}</span>
      <span>{status.busy ? steamSpeed(rate.bytesPerSecond) : status.stage === "complete" ? "已同步" : "待重试"}</span></span>
  </span>;
  return <span className="steam-sync-progress" role="status" aria-live="polite">
    <span className="steam-sync-heading"><strong>{verifying ? "正在校验并保存" : status.stage === "error" ? "同步未完成" : status.stage === "complete" ? "云存档已同步" : "云存档同步"}</strong>
      {percent !== undefined && <strong>{percent}%</strong>}</span>
    <progress className="steam-download-bar" aria-label="云存档同步进度" max={100} value={percent} />
    <span className="steam-sync-metrics">
      <span><small>已校验文件</small><span>{status.done ?? 0} / {status.total || "—"}</span></span>
      <span><small>已校验大小</small><span>{steamBytes(status.completedBytes ?? 0)} / {steamBytes(status.totalBytes ?? 0)}</span></span>
      <span><small>传输速度</small><span>{status.busy ? steamSpeed(rate.bytesPerSecond) : "—"}</span></span>
      <span><small>本次传输</small><span>{steamBytes(status.transferredBytes ?? 0)}</span></span>
    </span>
    <span className="steam-sync-count">{status.busy ? verifying ? "等待最终校验" : steamEta(rate.secondsRemaining, "传输已完成，等待校验") : status.stage === "complete" ? "所有存档均已校验" : "已校验文件保留，可继续同步"}{status.cachedFiles ? ` · 复用 ${status.cachedFiles} 个文件` : ""}</span>
    <span className="steam-sync-file" title={status.message}>{status.message || "正在读取 Steam 云存档清单…"}</span>
  </span>;
}
