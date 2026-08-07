import { useEffect, useState } from 'react';
import { fetch } from '../lib/http';

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
  default_tab?: 'stable' | 'ultra-stable';
  name?: string;
  description?: string;
  homepage?: string;
  versions: EverestUltraVersion[];
}

export type LoennPackageType = 'zip' | 'file';

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
  packages: Partial<Record<'windows' | 'linux' | 'macos', LoennPackage>>;
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
  'https://ganbei-hot-update-1258625969.file.myqcloud.com/celemod/updateInfo.json';

let cachedUpdateInfo: Promise<UpdateInfo> | null = null;

const parseUpdateInfo = (text: string) =>
  JSON.parse(
    text
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n'),
  ) as UpdateInfo;

export const getLatestUpdateInfo = (forceRefresh = false) => {
  if (!cachedUpdateInfo || forceRefresh) {
    cachedUpdateInfo = fetch(`${UPDATE_INFO_URL}?${Date.now()}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load update info: HTTP ${response.status}`);
        return response.text();
      })
      .then(parseUpdateInfo)
      .catch((error) => {
        cachedUpdateInfo = null;
        throw error;
      });
  }
  return cachedUpdateInfo;
};

export const featureVisible = (
  feature: { enabled: boolean; only_zh_cn?: boolean } | null | undefined,
  currentLang: string,
) => Boolean(feature?.enabled && (!feature.only_zh_cn || currentLang === 'zh-CN'));

export const useUpdateInfo = () => {
  const [data, setData] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    getLatestUpdateInfo()
      .then((value) => active && setData(value))
      .catch((reason) => active && setError(reason));
    return () => {
      active = false;
    };
  }, []);

  return { data, error };
};
