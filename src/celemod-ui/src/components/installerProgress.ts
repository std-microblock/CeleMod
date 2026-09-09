export interface AndroidInstallerProgress {
  stage: number;
  total: number;
  elapsed: number;
  detail: string;
}

export function parseAndroidInstallerProgress(status: string | null): AndroidInstallerProgress | null {
  const prefix = "Android installer: ";
  const index = status?.indexOf(prefix) ?? -1;
  if (index < 0 || !status) return null;
  try {
    const value = JSON.parse(status.slice(index + prefix.length));
    if (!Number.isInteger(value.stage) || value.stage < 1 || value.stage > 7 ||
        value.total !== 7 || !Number.isFinite(value.elapsed) || value.elapsed < 0 ||
        typeof value.detail !== "string") return null;
    return value;
  } catch { return null; }
}

export function formatInstallerElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function determinateInstallProgress(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(100, value) : null;
}
