import _i18n from "src/i18n";
import {
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./Everest.scss";
import { fetch } from "../lib/http";
import {
  useCurrentEverestVersion,
  useCurrentLang,
  useGamePath,
  useMirror,
  useCurrentEverestUltra,
} from "../states";
import { callRemote, displayDate } from "../utils";
import { Icon } from "../components/Icon";
import { Button } from "../components/Button";
import { useGlobalContext } from "../App";
import everest from "../resources/everest.png";
import { ProgressIndicator } from "../components/Progress";
import { createPopup, PopupContext } from "../components/Popup";
import {
  EverestUltraVersion,
  featureVisible,
  useUpdateInfo,
} from "../api/updateInfo";
import { useEverestInstallState } from "../context/everest";

interface Maddie480EverestVersion {
  date: string;
  mainFileSize: number;
  mainDownload: string;
  commit: string;
  branch: string;
  version: number;
}

interface DisplayVersion {
  key: string;
  version: string;
  date: string;
  commit?: string;
  size?: number;
  url: string;
}

const formatSize = (size?: number) => {
  if (!size) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
};

const versionBuild = (value: string) => {
  const numbers = value.match(/\d+/g)?.map(Number) ?? [];
  return numbers.length === 0 ? 0 : Math.max(...numbers);
};

const getInstallTip = (state: string | null) => {
  if (state?.startsWith("[1/3]")) return _i18n.t("正在下载");
  if (state?.startsWith("[2/3]")) return _i18n.t("正在解压");
  if (state?.startsWith("[4/4] download")) return _i18n.t("正在下载");
  if (state?.startsWith("[4/4] verify"))
    return _i18n.t("正在校验修复包");
  if (state?.startsWith("[4/4] install")) return _i18n.t("正在替换 Mod");
  return _i18n.t("正在安装");
};

const getInstallDetail = (state: string | null) => {
  if (!state) return null;
  return state
    .replace(/^\[\d+\/\d+\]\s*/, "")
    .replace(/^Download Everest:?/i, "")
    .replace(/^Extract Everest files:?/i, "")
    .replace(/^Run MiniInstaller:?/i, "")
    .trim();
};
const VersionList = ({
  versions,
  onInstall,
  installedVersion,
  installedEdition,
}: {
  versions: DisplayVersion[];
  onInstall: (url: string) => void;
  installedVersion: string;
  installedEdition: boolean;
}) => (
  <div className="version-list">
    {versions.length === 0 ? (
      <div className="empty">{_i18n.t("无数据")}</div>
    ) : (
      versions.map((item) => {
        const installedBuild = versionBuild(installedVersion);
        const installed =
          installedEdition &&
          installedBuild > 0 &&
          versionBuild(item.version) === installedBuild;
        return (
          <div
            key={item.key}
            className={`version-item${installed ? " installed" : ""}`}
          >
            <div className="version-main">
              <strong>{item.version}</strong>
              <span>{displayDate(item.date)}</span>
            </div>
            <div className="version-meta">
              <span>{item.commit?.slice(0, 7) || _i18n.t("镜像版本")}</span>
              {item.size ? <span>{formatSize(item.size)}</span> : null}
              <Button disabled={installed} onClick={() => onInstall(item.url)}>
                {installed ? _i18n.t("已安装") : _i18n.t("安装")}
              </Button>
            </div>
          </div>
        );
      })
    )}
  </div>
);

const OfficialChannel = ({
  versions,
  branch,
  title,
  onInstall,
  installedVersion,
  installedEdition,
}: {
  versions: Maddie480EverestVersion[];
  branch: string;
  title: string;
  onInstall: (url: string) => void;
  installedVersion: string;
  installedEdition: boolean;
}) => {
  const [mirror] = useMirror();
  const items = useMemo<DisplayVersion[]>(
    () =>
      versions
        .filter((version) => version.branch === branch.toLowerCase())
        .map((version) => ({
          key: `${version.branch}-${version.version}-${version.commit}`,
          version: String(version.version),
          date: version.date,
          commit: version.commit,
          size: version.mainFileSize,
          url:
            version.branch === "stable" && mirror === "wegfan"
              ? `https://celeste.weg.fan/api/v2/download/everest/${version.version}`
              : version.mainDownload,
        })),
    [branch, mirror, versions]
  );

  return (
    <section className="channel-card">
      <VersionList
        versions={items}
        onInstall={onInstall}
        installedVersion={installedVersion}
        installedEdition={installedEdition}
      />
    </section>
  );
};

const UltraChannel = ({
  versions,
  onInstall,
  installedVersion,
  installedEdition,
}: {
  versions: EverestUltraVersion[];
  onInstall: (url: string) => void;
  installedVersion: string;
  installedEdition: boolean;
}) => {
  return (
    <section className="channel-card tab-channel ultra-channel">
      <VersionList
        versions={versions
          .filter(
            (version) =>
              !version.channel || version.channel.toLowerCase() === "stable"
          )
          .map((version) => ({
            key: `ultra-stable-${version.version}-${
              version.commit || version.url
            }`,
            version: version.version,
            date: version.date,
            commit: version.commit,
            size: version.size,
            url: version.url,
          }))}
        installedVersion={installedVersion}
        installedEdition={installedEdition}
        onInstall={onInstall}
      />
    </section>
  );
};

type EverestTab = "stable" | "beta" | "dev" | "ultra-stable";

export const Everest = () => {
  const ctx = useGlobalContext();
  const { currentEverestVersion, setCurrentEverestVersion } =
    useCurrentEverestVersion();
  const { currentEverestIsUltra, setCurrentEverestIsUltra } =
    useCurrentEverestUltra();
  const { currentLang } = useCurrentLang();
  const [gamePath] = useGamePath();
  const { data: updateInfo } = useUpdateInfo();
  const ultra = updateInfo?.everest_ultra;
  const showUltra = featureVisible(ultra, currentLang);
  const [activeTab, setActiveTab] = useState<EverestTab>("stable");
  const cloudDefaultApplied = useRef(false);
  const {
    installingUrl,
    status: installState,
    progress: installProgress,
    failedReason,
  } = useEverestInstallState((state) => state.everestInstallState);
  const [everestData, setEverestData] = useState<
    Maddie480EverestVersion[] | null
  >(null);
  const [everestError, setEverestError] = useState<string | null>(null);

  useEffect(() => {
    if (!updateInfo || cloudDefaultApplied.current) return;
    setActiveTab(
      ultra?.default_tab === "ultra-stable" && showUltra
        ? "ultra-stable"
        : "stable"
    );
    cloudDefaultApplied.current = true;
  }, [showUltra, ultra?.default_tab, updateInfo]);

  useEffect(() => {
    if (!showUltra && activeTab === "ultra-stable") setActiveTab("stable");
  }, [activeTab, showUltra]);

  useEffect(() => {
    fetch(
      "https://maddie480.ovh/celeste/everest-versions?supportsNativeBuilds=true"
    )
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((value) => setEverestData(value))
      .catch((error) => setEverestError(String(error)));
  }, []);

  const installEverest = (url: string) => {
    ctx.everest.downloadAndInstallEverest(
      url,
      activeTab === "ultra-stable"
        ? (updateInfo?.crash_mod_fixes || []).filter(
            (fix) => fix.mod_name.toLocaleLowerCase() === "rushhelper"
          )
        : []
    );
  };

  const showManualVersionPopup = () => {
    createPopup(() => {
      const { hide } = useContext(PopupContext);
      const [manualVersion, setManualVersion] = useState(
        currentEverestVersion || ""
      );
      return (
        <div className="popup-content manual-everest-popup">
          <div className="title">{_i18n.t("手动指定 Everest 版本")}</div>
          <div className="content">
            <p>
              {_i18n.t(
                "如果你已经安装了 Everest，但 CeleMod 没有正确识别，可以在这里手动填写版本号。"
              )}
            </p>
            <p>
              {_i18n.t(
                "注意：如果实际上没有安装 Everest，就无法通过 Mod 方式启动游戏。"
              )}
            </p>
            <input
              type="text"
              value={manualVersion}
              placeholder={_i18n.t("例如 4000")}
              onInput={(event) =>
                setManualVersion((event.target as HTMLInputElement).value)
              }
            />
          </div>
          <div className="buttons">
            <button onClick={hide}>{_i18n.t("取消")}</button>
            <button
              onClick={() => {
                const version = manualVersion.trim();
                if (!version) return;
                setCurrentEverestVersion(version);
                setCurrentEverestIsUltra(false);
                hide();
              }}
            >
              {_i18n.t("确认")}
            </button>
          </div>
        </div>
      );
    });
  };

  return (
    <div className="everest">
      <header className="everest-header">
        <img src={everest} alt="Everest" />
        <div className="everest-status">
          <div
            className={`status-line ${
              currentEverestVersion ? "installed" : "missing"
            }`}
          >
            <div>
              <span className="ti">
                {currentEverestVersion
                  ? _i18n.t("当前安装的 Everest 版本")
                  : _i18n.t("未安装 Everest")}
              </span>
              <strong className="value">
                {currentEverestVersion || "—"}
                {currentEverestVersion && currentEverestIsUltra ? (
                  <span className="everest-edition-badge">Ultra</span>
                ) : null}
              </strong>
            </div>
          </div>
          {!currentEverestVersion ? (
            <button
              className="manual-everest-version"
              onClick={showManualVersionPopup}
            >
              {_i18n.t("我已安装 Everest，但未显示")}
            </button>
          ) : null}
        </div>
      </header>

      {installingUrl === null ? (
        <div className="everest-catalog">
          <div className="channel-tabs centered-tab-buttons">
            <button
              className={activeTab === "stable" ? "active" : ""}
              onClick={() => setActiveTab("stable")}
            >
              <Icon name="i-tick" />
              Stable
            </button>
            {showUltra ? (
              <button
                className={
                  activeTab === "ultra-stable" ? "active ultra" : "ultra"
                }
                onClick={() => setActiveTab("ultra-stable")}
              >
                <Icon name="chart-area" />
                Ultra Stable
              </button>
            ) : null}
            <button
              className={activeTab === "beta" ? "active" : ""}
              onClick={() => setActiveTab("beta")}
            >
              <Icon name="warn" />
              Beta
            </button>
            <button
              className={activeTab === "dev" ? "active" : ""}
              onClick={() => setActiveTab("dev")}
            >
              <Icon name="settings" />
              Dev
            </button>
          </div>

          {activeTab === "ultra-stable" && ultra ? (
            <Fragment>
              <div className="edition-description ultra-description">
                <div>
                  <span className="ultra-kicker">EVEREST · ACCELERATED</span>
                  <strong>
                    {ultra.name || "EverestUltra"}
                    {_i18n.t("· 加速启动版")}
                  </strong>
                  <p>{ultra.description}</p>
                </div>
              </div>
              <UltraChannel
                versions={ultra.versions || []}
                installedVersion={currentEverestVersion}
                installedEdition={currentEverestIsUltra}
                onInstall={installEverest}
              />
            </Fragment>
          ) : everestData ? (
            <OfficialChannel
              title={
                activeTab === "beta" || activeTab === "dev"
                  ? `${activeTab[0].toUpperCase()}${activeTab.slice(1)} Channel`
                  : ""
              }
              branch={activeTab}
              installedVersion={currentEverestVersion}
              installedEdition={!currentEverestIsUltra}
              versions={everestData}
              onInstall={installEverest}
            />
          ) : everestError ? (
            <div className="load-error">
              {_i18n.t("加载失败")}: {everestError}
            </div>
          ) : (
            <div className="catalog-loading">
              <ProgressIndicator infinite />
            </div>
          )}
        </div>
      ) : (
        <div className="installing">
          {installState === "Failed" ? (
            <Fragment>
              <div className="wrapperin">
                <Icon name="i-cross" />
              </div>
              <div className="tip">{_i18n.t("安装失败")}</div>
              <div className="url">{installingUrl}</div>
              <div className="state">
                <textarea readOnly value={failedReason || ""} />
              </div>
              <div className="state">
                <Button onClick={() => ctx.everest.clearInstallState()}>
                  {_i18n.t("取消")}
                </Button>
              </div>
            </Fragment>
          ) : installState === "Success" ? (
            <Fragment>
              <div className="wrapperin">
                <Icon name="i-tick" />
              </div>
              <div className="tip">{_i18n.t("安装成功")}</div>
              <div className="url">{installingUrl}</div>
              <div className="state">
                <Button onClick={() => ctx.everest.clearInstallState()}>
                  {_i18n.t("确认")}
                </Button>
              </div>
            </Fragment>
          ) : (
            <Fragment>
              <div className="wrapperin">
                <ProgressIndicator
                  {...(installProgress !== null
                    ? { value: installProgress, max: 100 }
                    : { infinite: true })}
                />
              </div>
              <div className="tip">{getInstallTip(installState)}</div>
              <div className="url">{installingUrl}</div>
              {getInstallDetail(installState) ? (
                <div className="state">{getInstallDetail(installState)}</div>
              ) : null}
            </Fragment>
          )}
        </div>
      )}
    </div>
  );
};
