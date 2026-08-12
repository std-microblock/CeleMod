import { useContext, useEffect, useState } from "react";
import _i18n from "./i18n";
import { PopupContext, createPopup } from "./components/Popup";
import { ProgressIndicator } from "./components/Progress";
import { loadModCatalog, type CatalogMod } from "./api/modCatalog";
import type { ModBlacklistProfile, ProfileImportResult } from "./ipc/blacklist";
import { useDownloadStore, type Download } from "./stores/download";
import {
  reloadBlacklistState,
  reloadInstalledMods,
  useAppStore,
} from "./states";
import { callRemote } from "./utils";

export interface ProfileImportProgress {
  total: number;
  finished: number;
  failed: number;
  current: string;
  progress: number;
  discovered: string[];
}

export interface ProfileImportPlan {
  profiles: ModBlacklistProfile[];
  requestedMods: string[];
  missingMods: string[];
  unresolvedMods: string[];
  downloads: CatalogMod[];
}

const parseProfileImportResult = (raw: string) => {
  try {
    return JSON.parse(raw) as ProfileImportResult;
  } catch {
    throw new Error(raw);
  }
};

const normalizedKey = (value: string) =>
  value
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLocaleLowerCase();

export const previewProfileFile = async (
  gamePath: string,
  sourcePath: string
) =>
  parseProfileImportResult(
    await callRemote<string>("preview_mod_profiles", gamePath, sourcePath)
  );

export const previewProfileJson = async (gamePath: string, contents: string) =>
  parseProfileImportResult(
    await callRemote<string>("preview_mod_profiles_json", gamePath, contents)
  );

export const previewOlympusProfiles = async (
  gamePath: string,
  profileNames: string[]
) =>
  parseProfileImportResult(
    await callRemote<string>(
      "preview_olympus_profiles",
      gamePath,
      JSON.stringify(profileNames)
    )
  );

export const previewProfileModList = (
  gamePath: string,
  name: string,
  modNames: string[],
  autoDeps: boolean
) =>
  previewProfileJson(
    gamePath,
    JSON.stringify({
      format: "celemod-profile",
      version: 2,
      ...(autoDeps ? { auto_deps: true } : {}),
      name,
      enabled_mods: modNames,
    })
  );

export const resolveProfileImportPlan = async (
  result: ProfileImportResult
): Promise<ProfileImportPlan> => {
  const catalog = await loadModCatalog();
  const catalogByName = new Map(
    catalog.map((mod) => [mod.name.toLocaleLowerCase(), mod])
  );
  const catalogByFile = new Map(
    catalog.map((mod) => [normalizedKey(mod.name), mod])
  );
  const missingFileKeys = new Set(result.missing_files.map(normalizedKey));
  const olympusAliases = new Map<string, string>();
  for (const file of result.missing_files) {
    const mod = catalogByFile.get(normalizedKey(file));
    if (mod) olympusAliases.set(file.toLocaleLowerCase(), mod.name);
  }
  const profiles = result.profiles.map((profile) => ({
    ...profile,
    enabled_mods: profile.enabled_mods.map(
      (name) => olympusAliases.get(name.toLocaleLowerCase()) ?? name
    ),
  }));
  const requestedMods = [
    ...new Set(profiles.flatMap((profile) => profile.enabled_mods)),
  ];
  const unresolvedMods: string[] = [];
  const downloadsByName = new Map<string, CatalogMod>();
  for (const missing of result.missing_mods) {
    const mod =
      catalogByName.get(missing.toLocaleLowerCase()) ??
      catalogByFile.get(normalizedKey(missing));
    if (mod) downloadsByName.set(mod.name.toLocaleLowerCase(), mod);
    else unresolvedMods.push(missing);
  }
  for (const fileKey of missingFileKeys) {
    const mod = catalogByFile.get(fileKey);
    if (mod) downloadsByName.set(mod.name.toLocaleLowerCase(), mod);
    else {
      const file = result.missing_files.find(
        (candidate) => normalizedKey(candidate) === fileKey
      );
      if (file) unresolvedMods.push(file);
    }
  }
  return {
    profiles,
    requestedMods,
    missingMods: result.missing_mods,
    unresolvedMods: [...new Set(unresolvedMods)],
    downloads: [...downloadsByName.values()],
  };
};

const sourceForMod = (mod: CatalogMod) => {
  const file = mod.submissionFile;
  return file.gameBananaId && file.gameBananaId > 0
    ? String(file.gameBananaId)
    : file.url;
};

const downloadPlannedMods = async (
  plan: ProfileImportPlan,
  onProgress: (progress: ProfileImportProgress) => void
) => {
  const roots = plan.downloads.map((mod) => mod.name);
  const taskSnapshots = new Map<string, Download.TaskInfo>();
  const discovered = new Set<string>();
  const report = (current: string) => {
    const allSubtasks = [...taskSnapshots.values()].flatMap(
      (task) => task.subtasks
    );
    for (const subtask of allSubtasks) {
      if (!roots.some((root) => root === subtask.name)) {
        discovered.add(subtask.name);
      }
    }
    const finished = allSubtasks.filter(
      (subtask) => subtask.state === "Finished"
    ).length;
    const failed = allSubtasks.filter(
      (subtask) => subtask.state === "Failed"
    ).length;
    const active = allSubtasks.find(
      (subtask) => subtask.state === "Downloading"
    );
    onProgress({
      total: Math.max(plan.downloads.length, allSubtasks.length),
      finished,
      failed,
      current: active?.name ?? current,
      progress: active?.progress ?? 0,
      discovered: [...discovered],
    });
  };
  report("");

  await Promise.all(
    plan.downloads.map(
      (mod) =>
        new Promise<void>((resolve, reject) => {
          const source = sourceForMod(mod);
          if (!source) {
            reject(new Error(`${mod.name}: 没有可用下载地址`));
            return;
          }
          const alreadyInstalled = useAppStore
            .getState()
            .installedMods.some((item) => item.name === mod.name);
          useDownloadStore.getState().downloadMod(mod.name, source, {
            force: alreadyInstalled,
            autoDisableNewMods: false,
            deferProfileUpdate: true,
            onProgress: (task) => {
              taskSnapshots.set(mod.name, task);
              report(mod.name);
            },
            onFinished: (task) => {
              taskSnapshots.set(mod.name, task);
              report(mod.name);
              resolve();
            },
            onFailed: (task, error) => {
              taskSnapshots.set(mod.name, task);
              report(mod.name);
              reject(new Error(`${mod.name}: ${error}`));
            },
          });
        })
    )
  );
  return [...discovered];
};
const commitProfiles = async (
  gamePath: string,
  profiles: ModBlacklistProfile[]
) => {
  await reloadInstalledMods();
  const raw = await callRemote<string>(
    "commit_mod_profiles",
    gamePath,
    JSON.stringify(profiles)
  );
  const result = parseProfileImportResult(raw);
  await reloadBlacklistState(gamePath);
  return result;
};

export const executeProfileImport = async (
  gamePath: string,
  plan: ProfileImportPlan,
  onProgress: (progress: ProfileImportProgress) => void
) => {
  if (plan.unresolvedMods.length > 0) {
    throw new Error(`找不到 Mod：${plan.unresolvedMods.join(", ")}`);
  }
  await downloadPlannedMods(plan, onProgress);
  return commitProfiles(gamePath, plan.profiles);
};

const ProfileInstallProgress = ({
  plan,
  onDone,
}: {
  plan: ProfileImportPlan;
  onDone: () => void;
}) => {
  const popup = useContext(PopupContext);
  const gamePath = useAppStore((state) => state.gamePath);
  const [progress, setProgress] = useState<ProfileImportProgress>({
    total: plan.downloads.length,
    finished: 0,
    failed: 0,
    current: "",
    progress: 0,
    discovered: [],
  });
  const [error, setError] = useState("");

  useEffect(() => {
    void executeProfileImport(gamePath, plan, setProgress)
      .then(() => {
        onDone();
        popup.hide();
      })
      .catch((reason) => setError(String(reason)));
  }, []);

  const value =
    progress.finished +
    progress.failed +
    Math.max(0, Math.min(100, progress.progress)) / 100;
  return (
    <div className="popup-content profile-install-progress-popup">
      <div className="title">{_i18n.t("正在安装 Profile")}</div>
      <div className="content">
        {error ? (
          <div className="fatal-error">{error}</div>
        ) : (
          <>
            <ProgressIndicator
              size={78}
              lineWidth={5}
              {...(progress.total
                ? { value, max: progress.total }
                : { value: 1, max: 1 })}
            />
            <strong>{progress.current || _i18n.t("正在完成 Profile")}</strong>
            <span>
              {progress.finished} / {progress.total}
            </span>
            {progress.discovered.length > 0 && (
              <div className="profile-install-discovered">
                {_i18n.t("已发现依赖")}：{progress.discovered.join(", ")}
              </div>
            )}
          </>
        )}
      </div>
      {error && (
        <div className="buttons">
          <button onClick={popup.hide}>{_i18n.t("确认")}</button>
        </div>
      )}
    </div>
  );
};

const ProfileInstallConfirm = ({
  plan,
  onCancel,
  onConfirm,
}: {
  plan: ProfileImportPlan;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  return (
    <div className="popup-content profile-install-confirm-popup">
      <div className="title">{_i18n.t("确认安装 Profile")}</div>
      <div className="content">
        <div className="profile-install-summary">
          <strong>
            {plan.profiles.map((profile) => profile.name).join(", ")}
          </strong>
          <span>{plan.requestedMods.length} Mods</span>
        </div>
        <section>
          <h4>{_i18n.t("将启用")}</h4>
          <div>{plan.requestedMods.join(", ") || _i18n.t("无")}</div>
        </section>
        <section>
          <h4>{_i18n.t("需要安装")}</h4>
          <div>
            {plan.downloads.map((mod) => mod.name).join(", ") || _i18n.t("无")}
          </div>
        </section>
        {plan.profiles.some((profile) => profile.auto_deps) && (
          <section>
            <h4>{_i18n.t("自动补全依赖")}</h4>
            <div>
              {_i18n.t("安装过程中发现的必需依赖也会下载并加入 Profile")}
            </div>
          </section>
        )}
        {plan.unresolvedMods.length > 0 && (
          <section className="failed">
            <h4>{_i18n.t("无法找到")}</h4>
            <div>{plan.unresolvedMods.join(", ")}</div>
          </section>
        )}
      </div>
      <div className="buttons">
        <button onClick={onCancel}>{_i18n.t("取消")}</button>
        <button disabled={plan.unresolvedMods.length > 0} onClick={onConfirm}>
          {_i18n.t("开始安装")}
        </button>
      </div>
    </div>
  );
};

const waitForProfileConfirmation = (plan: ProfileImportPlan) =>
  new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const controls = createPopup(
      () => (
        <ProfileInstallConfirm
          plan={plan}
          onCancel={() => {
            settle(false);
            controls.hide();
          }}
          onConfirm={() => {
            settle(true);
            controls.hide();
          }}
        />
      ),
      { cancelable: false }
    );
  });

const installProfilePlan = async (
  plan: ProfileImportPlan,
  onDone: () => void = () => undefined
) => {
  if (!(await waitForProfileConfirmation(plan))) return false;
  createPopup(() => <ProfileInstallProgress plan={plan} onDone={onDone} />, {
    cancelable: false,
  });
  return true;
};

export const installProfileFile = async (
  gamePath: string,
  sourcePath: string,
  onDone?: () => void
) =>
  installProfilePlan(
    await resolveProfileImportPlan(
      await previewProfileFile(gamePath, sourcePath)
    ),
    onDone
  );

export const installProfileJson = async (
  gamePath: string,
  contents: string,
  onDone?: () => void
) =>
  installProfilePlan(
    await resolveProfileImportPlan(
      await previewProfileJson(gamePath, contents)
    ),
    onDone
  );

export const installProfileModList = async (
  gamePath: string,
  name: string,
  modNames: string[],
  autoDeps: boolean,
  onDone?: () => void
) =>
  installProfilePlan(
    await resolveProfileImportPlan(
      await previewProfileModList(gamePath, name, modNames, autoDeps)
    ),
    onDone
  );

export const installOlympusProfiles = async (
  gamePath: string,
  profileNames: string[],
  onDone?: () => void
) =>
  installProfilePlan(
    await resolveProfileImportPlan(
      await previewOlympusProfiles(gamePath, profileNames)
    ),
    onDone
  );
export const installSingleMod = async (
  mod: CatalogMod,
  onDone: () => void = () => undefined
) =>
  new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const plan: ProfileImportPlan = {
      profiles: [],
      requestedMods: [mod.name],
      missingMods: [mod.name],
      unresolvedMods: [],
      downloads: [mod],
    };
    createPopup(
      () => {
        const popup = useContext(PopupContext);
        const [progress, setProgress] = useState<ProfileImportProgress | null>(
          null
        );
        const [error, setError] = useState("");
        const [installing, setInstalling] = useState(false);
        return (
          <div className="popup-content profile-install-confirm-popup">
            <div className="title">
              {installing ? _i18n.t("正在安装 Mod") : _i18n.t("确认安装 Mod")}
            </div>
            <div className="content">
              {error ? (
                <div className="fatal-error">{error}</div>
              ) : installing ? (
                <>
                  <ProgressIndicator
                    size={78}
                    lineWidth={5}
                    value={
                      (progress?.finished ?? 0) +
                      Math.max(0, Math.min(100, progress?.progress ?? 0)) / 100
                    }
                    max={Math.max(1, progress?.total ?? 1)}
                  />
                  <strong>{progress?.current || mod.name}</strong>
                  {progress?.discovered.length ? (
                    <div>
                      {_i18n.t("将补全")}：{progress.discovered.join(", ")}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="profile-install-summary">
                    <strong>{mod.name}</strong>
                    <span>{mod.version}</span>
                  </div>
                  <section>
                    <h4>{_i18n.t("依赖")}</h4>
                    <div>{_i18n.t("安装过程中发现的必需依赖会自动补全")}</div>
                  </section>
                </>
              )}
            </div>
            <div className="buttons">
              {!installing && !error && (
                <button
                  onClick={() => {
                    settle(false);
                    popup.hide();
                  }}
                >
                  {_i18n.t("取消")}
                </button>
              )}
              {error ? (
                <button
                  onClick={() => {
                    settle(false);
                    popup.hide();
                  }}
                >
                  {_i18n.t("确认")}
                </button>
              ) : !installing ? (
                <button
                  onClick={() => {
                    setInstalling(true);
                    void downloadPlannedMods(plan, setProgress)
                      .then(() => {
                        onDone();
                        settle(true);
                        popup.hide();
                      })
                      .catch((reason) => setError(String(reason)));
                  }}
                >
                  {_i18n.t("开始安装")}
                </button>
              ) : null}
            </div>
          </div>
        );
      },
      { cancelable: false }
    );
  });
