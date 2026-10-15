/* Rules shared by the download store and the Downloads page.  They live in a
   plain module (no store/tauri imports) so they can be unit tested directly. */

export interface DownloadTaskState {
  state: "finished" | "failed" | "pending";
  canceled?: boolean;
  settledAt?: number;
}

export type DownloadAttemptDecision = "start" | "attach";

/**
 * What `downloadMod` should do when a task with the same name already exists.
 *
 * - `start`  – nothing is running for this Mod, run a new attempt.
 * - `attach` – an attempt is already in flight, so forward its outcome to the
 *              new caller instead of starting a second download of the same
 *              file.
 *
 * A canceled task still carries `state: "pending"`, but its download is over:
 * treating it as "in flight" left buttons that await the returned promise (the
 * Mod list download button, "下载缺失依赖") disabled with no way to restart.
 */
export const downloadAttemptDecision = (
  existing: DownloadTaskState | undefined,
  force: boolean,
): DownloadAttemptDecision => {
  if (force || !existing) return "start";
  if (existing.state !== "pending") return "start";
  if (existing.canceled) return "start";
  return "attach";
};

/**
 * Finished rows are kept for a moment so the user sees the task complete, then
 * they disappear.  Nothing else ever removed them, so a finished download kept
 * sitting in the Downloads page at 100% (with the sidebar badge already back to
 * zero) until the app was restarted.
 */
export const FINISHED_ROW_GRACE_MS = 4_000;

export const isDownloadRowVisible = (
  task: DownloadTaskState,
  now: number,
  grace = FINISHED_ROW_GRACE_MS,
) => {
  if (task.state !== "finished") return true;
  const settledAt = task.settledAt ?? now;
  return now - settledAt < grace;
};

/** Timestamp at which the next finished row falls out of its grace period. */
export const nextDownloadRowExpiry = (
  tasks: DownloadTaskState[],
  now: number,
  grace = FINISHED_ROW_GRACE_MS,
): number | null => {
  const expiries = tasks
    .filter((task) => task.state === "finished" && task.settledAt !== undefined)
    .map((task) => task.settledAt! + grace)
    .filter((expiry) => expiry > now);
  return expiries.length > 0 ? Math.min(...expiries) : null;
};
