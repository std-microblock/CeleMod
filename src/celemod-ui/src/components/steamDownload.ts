import type { SteamStatus } from "./steamState";

export type SteamDownloadRate = {
  bytesPerSecond?: number;
  secondsRemaining?: number;
};
type Sample = {
  at: number;
  done: number;
  downloaded: number;
  transferred: number;
};

/** Eight-second moving throughput, measured on successful status polls (not revisions).
 * Duplicate snapshots age a stalled transfer down to zero. Never mix jobs, cache
 * reuse, or time spent with the WebView suspended into a new speed estimate.
 */
export class SteamDownloadMeter {
  private samples: Sample[] = [];
  private key = "";

  sample(status: SteamStatus | undefined, now: number): SteamDownloadRate {
    const syncing = status?.stage === "syncing";
    const done = syncing ? status.completedBytes : status?.done;
    const total = syncing ? status.totalBytes : status?.total;
    const downloaded = syncing
      ? status.completedBytes
      : status?.downloadedBytes;
    const transferred = status?.transferredBytes;
    if (
      !status?.busy ||
      (!syncing &&
        (status.operation !== "download" || status.stage !== "downloading")) ||
      ![now, done, total, downloaded, transferred].every(
        (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
      ) ||
      !total
    ) {
      this.samples = [];
      this.key = "";
      return {};
    }
    const point: Sample = {
      at: now,
      done: done!,
      downloaded: downloaded!,
      transferred: transferred!,
    };
    const key = `${status.job}:${status.stage}:${total}`;
    const last = this.samples.at(-1);
    if (
      key !== this.key ||
      (last &&
        (now <= last.at ||
          now - last.at > 15000 ||
          point.done < last.done ||
          point.downloaded < last.downloaded ||
          point.transferred < last.transferred))
    )
      this.samples = [];
    this.key = key;
    this.samples.push(point);
    while (this.samples.length > 2 && this.samples[1].at <= now - 8000)
      this.samples.shift();
    const first = this.samples[0];
    const elapsed = (now - first.at) / 1000;
    if (elapsed < 1) return {};
    const usefulRate = (point.downloaded - first.downloaded) / elapsed;
    return {
      bytesPerSecond: (point.transferred - first.transferred) / elapsed,
      secondsRemaining:
        point.done >= total!
          ? 0
          : usefulRate > 0
            ? (total! - point.done) / usefulRate
            : undefined,
    };
  }
}

export function steamSpeed(rate?: number) {
  if (rate === undefined || !Number.isFinite(rate) || rate < 0)
    return "计算速度…";
  if (rate === 0) return "0 B/s";
  const units = ["B/s", "KiB/s", "MiB/s", "GiB/s"];
  const unit = Math.min(
    3,
    Math.max(0, Math.floor(Math.log(rate) / Math.log(1024))),
  );
  return `${(rate / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function steamEta(seconds?: number, completeLabel = "下载已完成") {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0)
    return "剩余时间待估算";
  if (seconds === 0) return completeLabel;
  if (seconds < 60) return `剩余约 ${Math.ceil(seconds)} 秒`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `剩余约 ${minutes} 分钟`;
  return `剩余约 ${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ""}`;
}
