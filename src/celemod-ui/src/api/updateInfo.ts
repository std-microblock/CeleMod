import { useEffect, useState } from "react";
import { fetch } from "../lib/http";

export interface DownloadLink {
  name: string;
  url: string;
}

export interface EverestUltraVersion {
  version: string;
  channel: string;
  date: string;
  commit?: string;
  url: string;
  size?: number;
  sha256?: string;
}

export interface EverestUltraConfig {
  enabled: boolean;
  only_zh_cn?: boolean;
  default_tab?: "stable" | "ultra-stable";
  name?: string;
  description?: string;
  homepage?: string;
  versions: EverestUltraVersion[];
}

export type LoennPackageType = "zip" | "file";

export interface LoennPackage {
  url: string;
  file_name: string;
  package_type: LoennPackageType;
  executable: string;
  size?: number;
  sha256?: string;
}

export interface LoennVersion {
  version: string;
  date: string;
  description?: string;
  packages: Partial<Record<"windows" | "linux" | "macos", LoennPackage>>;
}

export interface LoennConfig {
  enabled: boolean;
  only_zh_cn?: boolean;
  name?: string;
  description?: string;
  homepage?: string;
  versions: LoennVersion[];
}

export interface CrashModFix {
  id: string;
  mod_name: string;
  affected_versions: string[];
  fixed_version: string;
  description?: string;
  url: string;
  size?: number;
  sha256: string;
  match?: {
    contains?: string[];
  };
}

export interface UpdateInfo {
  version: string;
  info: string;
  auto_download: DownloadLink[];
  manual: DownloadLink[];
  force?: string;
  everest_ultra?: EverestUltraConfig;
  loenn?: LoennConfig;
  crash_mod_fixes?: CrashModFix[];
}

const UPDATE_INFO_URL =
  "https://ganbei-hot-update-1258625969.file.myqcloud.com/celemod/updateInfo.json";

let cachedUpdateInfo: Promise<UpdateInfo> | null = null;
let cachedUpdateInfoRequestId = 0;
let forcedUpdateInfoRequest: Promise<UpdateInfo> | null = null;
let lastForcedUpdateAt = 0;
const MANUAL_REFRESH_COOLDOWN_MS = 10_000;
type UpdateInfoListener = (value: UpdateInfo) => void;
const updateInfoListeners = new Set<UpdateInfoListener>();

const notifyUpdateInfo = (value: UpdateInfo) => {
  for (const listener of updateInfoListeners) {
    try {
      listener(value);
    } catch (error) {
      console.error("Failed to notify update info listener", error);
    }
  }
};

const parseUpdateInfo = (text: string) =>
  JSON.parse(
    text
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n"),
  ) as UpdateInfo;

export const getLatestUpdateInfo = (forceRefresh = false) => {
  if (!cachedUpdateInfo || forceRefresh) {
    const requestId = ++cachedUpdateInfoRequestId;
    console.info(
      `[update-info] Fetching latest version information (${forceRefresh ? "forced refresh" : "cache miss"}, request ${requestId})`,
    );
    const request = fetch(`${UPDATE_INFO_URL}?${Date.now()}-${requestId}`)
      .then((response) => {
        if (!response.ok)
          throw new Error(
            `Failed to load update info: HTTP ${response.status}`,
          );
        return response.text();
      })
      .then(parseUpdateInfo)
      .then((value) => {
        console.info(
          `[update-info] Latest version information loaded: ${value.version} (request ${requestId})`,
        );
        return value;
      });
    cachedUpdateInfo = request;
    void request.then(
      (value) => {
        if (
          cachedUpdateInfo === request &&
          cachedUpdateInfoRequestId === requestId
        ) {
          notifyUpdateInfo(value);
        }
      },
      () => {
        if (
          cachedUpdateInfo === request &&
          cachedUpdateInfoRequestId === requestId
        ) {
          cachedUpdateInfo = null;
        }
      },
    );
  } else {
    console.info(
      `[update-info] Using cached latest version information (request ${cachedUpdateInfoRequestId})`,
    );
  }
  return cachedUpdateInfo;
};

export const refreshLatestUpdateInfo = () => {
  if (forcedUpdateInfoRequest) return forcedUpdateInfoRequest;
  const now = Date.now();
  if (
    cachedUpdateInfo &&
    now - lastForcedUpdateAt < MANUAL_REFRESH_COOLDOWN_MS
  ) {
    console.info(
      `[update-info] Manual refresh throttled; using cached request ${cachedUpdateInfoRequestId}`,
    );
    return cachedUpdateInfo;
  }
  lastForcedUpdateAt = now;
  const request = getLatestUpdateInfo(true);
  forcedUpdateInfoRequest = request;
  void request.then(
    () => {
      if (forcedUpdateInfoRequest === request) forcedUpdateInfoRequest = null;
    },
    () => {
      if (forcedUpdateInfoRequest === request) forcedUpdateInfoRequest = null;
    },
  );
  return request;
};

export const subscribeToUpdateInfo = (listener: UpdateInfoListener) => {
  updateInfoListeners.add(listener);
  return () => updateInfoListeners.delete(listener);
};

export const useUpdateInfo = () => {
  const [data, setData] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeToUpdateInfo((value) => {
      if (!active) return;
      setData(value);
      setError(null);
    });
    const request = getLatestUpdateInfo();
    const requestId = cachedUpdateInfoRequestId;
    void request.then(
      (value) => {
        if (active && requestId === cachedUpdateInfoRequestId) {
          setData(value);
          setError(null);
        }
      },
      (reason) => {
        if (active && requestId === cachedUpdateInfoRequestId) setError(reason);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { data, error };
};

export const featureVisible = (
  feature: { enabled: boolean; only_zh_cn?: boolean } | null | undefined,
  currentLang: string,
) =>
  Boolean(feature?.enabled && (!feature.only_zh_cn || currentLang === "zh-CN"));
