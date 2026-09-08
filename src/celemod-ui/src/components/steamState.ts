export type SteamStatus = {
  account: string; steamId: string; busy: boolean; cloud: boolean; offline: boolean;
  pending: boolean; stage?: string; message?: string; done?: number; total?: number;
  downloadedBytes?: number | null; transferredBytes?: number | null;
  pendingOtherAccount?: boolean;
  hasSavedPassword?: boolean;
  operation?: string; job?: string; revision?: string;
  conflicts?: { name: string; local: string | null; remote: string | null }[];
  game?: string;
};
export type SteamPanel = "main" | "login" | "download" | "settings" | "logout" | "local" | "cloud" | "disable-cloud";

// Recovered backend jobs take precedence over local navigation.
export function steamScreen(status: SteamStatus | undefined, panel: SteamPanel) {
  if (!status) return "loading";
  if (status.busy) {
    if (status.stage === "guard-confirm") return "approval";
    if (status.stage === "guard-device" || status.stage === "guard-email") return "code";
    return "progress";
  }
  if (!status.account) return "login";
  if (panel !== "main") return panel;
  if (status.stage === "conflict") return "conflict";
  return "overview";
}
export function canUseSavedSteamPassword(status: SteamStatus | undefined, account: string) {
  return !!status?.hasSavedPassword && !!status.account &&
    status.account.toLowerCase() === account.trim().toLowerCase();
}
export function steamProgress(status?: SteamStatus) {
  if (!status?.total || !Number.isFinite(status.total) || status.total <= 0 || !Number.isFinite(status.done ?? 0)) return undefined;
  return Math.round(Math.max(0, Math.min(1, (status.done ?? 0) / status.total)) * 100);
}
export function steamActivity(status?: SteamStatus) {
  switch (status?.stage) {
    case "guard-confirm": return "在 Steam 中确认登录";
    case "guard-device": case "guard-email": return "需要 Steam Guard 验证";
    case "authenticating": return "正在验证账号";
    case "manifest": return "正在准备游戏文件";
    case "downloading": return "正在下载 Celeste";
    case "downloaded": return "游戏文件已就绪";
    case "syncing": return "正在同步云存档";
    default: return status?.operation === "download" ? "正在准备下载" : status?.operation === "sync" || status?.operation === "resolve" ? "正在连接 Steam 云" : "正在连接 Steam";
  }
}
export function steamIssue(message: string) {
  if (/InvalidPassword|InvalidLoginAuthCode|账号.*密码/.test(message))
    return { title: "登录未成功", hint: "请检查 Steam 登录账号和密码。这里填写的不是个人资料昵称。" };
  if (/Expired|Revoked|登录已失效|AccessDenied/.test(message))
    return { title: "需要重新登录", hint: "Steam 登录状态可能已失效。重新登录不会删除本地游戏或存档。" };
  if (/RateLimit|TooMany|限流/.test(message))
    return { title: "尝试次数过多", hint: "请稍等片刻再试，避免连续提交登录请求。" };
  if (/空间|IOException|磁盘/.test(message))
    return { title: "无法写入游戏文件", hint: "请检查手机剩余空间，然后重试。已有存档会保留。" };
  if (/权限|拥有 Celeste|subscription/i.test(message))
    return { title: "无法下载 Celeste", hint: "请使用拥有 Celeste 下载权限的 Steam 账号。" };
  if (/另一个|其他账号|绑定/.test(message))
    return { title: "需要切回原账号", hint: "为避免混用存档，请使用这份游戏绑定的 Steam 账号完成同步。" };
  if (/网络|连接|超时|Timeout|HttpRequest|Socket|DNS/i.test(message))
    return { title: "暂时无法连接 Steam", hint: "检查网络连接，或切换 Wi-Fi / 移动网络后再试。未同步的存档会保留。" };
  return { title: "这一步没有完成", hint: "本地游戏与存档会保留。请查看原因后重试。" };
}
