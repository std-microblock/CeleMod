import { useEffect, useMemo, useState } from "react";
import _i18n from "../i18n";
import { featureVisible, LoennPackage, useUpdateInfo } from "../api/updateInfo";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { ProgressIndicator } from "../components/Progress";
import { useCurrentLang } from "../states";
import { callRemote, displayDate } from "../utils";
import "./Loenn.scss";

interface LoennState {
  installed: boolean;
  version: string | null;
  path: string | null;
}

type RuntimePlatform = "windows" | "linux" | "macos";

const formatSize = (size?: number) => {
  if (!size) return "";
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const progressLabel = (state: string | null) => {
  if (state === "download") return _i18n.t("正在下载 Loenn");
  if (state === "verify") return _i18n.t("正在校验文件");
  if (state === "extract") return _i18n.t("正在解压 Loenn");
  if (state === "install") return _i18n.t("正在完成安装");
  return _i18n.t("准备安装");
};

export const Loenn = () => {
  const { currentLang } = useCurrentLang();
  const { data: updateInfo, error: configError } = useUpdateInfo();
  const config = updateInfo?.loenn;
  const visible = featureVisible(config, currentLang);
  const [platform, setPlatform] = useState<RuntimePlatform | null>(null);
  const [localState, setLocalState] = useState<LoennState | null>(null);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [installState, setInstallState] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<number | null>(null);
  const [failedReason, setFailedReason] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const refreshLocalState = () =>
    callRemote<LoennState>("get_loenn_state")
      .then(setLocalState)
      .catch((error) => setLaunchError(String(error)));

  useEffect(() => {
    callRemote<string>("runtime_platform")
      .then((value) => setPlatform(value as RuntimePlatform))
      .catch((error) => setLaunchError(String(error)));
    void refreshLocalState();
  }, []);

  useEffect(() => {
    if (!selectedVersion && config?.versions?.[0]) {
      setSelectedVersion(config.versions[0].version);
    }
  }, [config, selectedVersion]);

  const version = useMemo(
    () =>
      config?.versions?.find((item) => item.version === selectedVersion) ||
      config?.versions?.[0],
    [config, selectedVersion]
  );
  const selectedPackage: LoennPackage | undefined =
    platform && version ? version.packages[platform] : undefined;
  const installing =
    installState !== null &&
    installState !== "success" &&
    installState !== "failed";

  const install = () => {
    if (!version || !selectedPackage) return;
    setInstallState("download");
    setInstallProgress(0);
    setFailedReason(null);
    callRemote(
      "download_and_install_loenn",
      version.version,
      selectedPackage.url,
      selectedPackage.package_type,
      selectedPackage.file_name,
      selectedPackage.executable,
      selectedPackage.sha256 || "",
      (state: string, value: unknown) => {
        setInstallState(state);
        if (state === "failed") {
          setFailedReason(String(value));
        } else if (typeof value === "number") {
          setInstallProgress(value);
        }
        if (state === "success") void refreshLocalState();
      }
    ).catch((error) => {
      setInstallState("failed");
      setFailedReason(String(error));
    });
  };

  const launch = () => {
    setLaunchError(null);
    callRemote("start_loenn").catch((error) => setLaunchError(String(error)));
  };

  if (!updateInfo && !configError) {
    return (
      <div className="loenn loenn-loading">
        <ProgressIndicator infinite />
      </div>
    );
  }

  if (!visible || !config) {
    return (
      <div className="loenn loenn-unavailable">
        {_i18n.t("Loenn 当前不可用")}
      </div>
    );
  }

  return (
    <div className="loenn">
      <header className="loenn-header">
        <div>
          <h1>{config.name || "Lönn"}</h1>
          <p>{config.description}</p>
        </div>
        <div className="header-actions">
          {config.homepage ? (
            <Button onClick={() => callRemote("open_url", config.homepage!)}>
              <Icon name="external" /> {_i18n.t("项目主页")}
            </Button>
          ) : null}
          {localState?.path ? (
            <Button onClick={() => callRemote("open_url", localState.path!)}>
              <Icon name="drive" /> {_i18n.t("安装目录")}
            </Button>
          ) : null}
        </div>
      </header>

      <section className="loenn-local">
        <div>
          <span className="label">{_i18n.t("本地版本")}</span>
          <strong>
            {localState?.installed ? localState.version : _i18n.t("尚未安装")}
          </strong>
          {localState?.installed ? (
            <span className="installed">
              <Icon name="i-tick" /> {_i18n.t("已安装")}
            </span>
          ) : null}
        </div>
        <Button
          type="primary"
          disabled={!localState?.installed}
          onClick={launch}
        >
          {_i18n.t("启动 Loenn")}
        </Button>
      </section>
      {launchError ? <div className="inline-error">{launchError}</div> : null}

      <section className="loenn-install">
        <div className="install-heading">
          <h2>{_i18n.t("安装或更新")}</h2>
          <label>
            <span>{_i18n.t("版本")}</span>
            <select
              value={version?.version || ""}
              onChange={(event) => setSelectedVersion(event.target.value)}
              disabled={installing}
            >
              {(config.versions || []).map((item) => (
                <option key={item.version} value={item.version}>
                  {item.version}
                </option>
              ))}
            </select>
          </label>
        </div>

        {version ? (
          <div className="release-info">
            <span>
              <Icon name="calendar" /> {displayDate(version.date)}
            </span>
            {selectedPackage?.size ? (
              <span>
                <Icon name="download" /> {formatSize(selectedPackage.size)}
              </span>
            ) : null}
            {version.description ? <p>{version.description}</p> : null}
          </div>
        ) : null}

        {!platform ? (
          <div className="package-note">{_i18n.t("正在检测系统")}</div>
        ) : !selectedPackage ? (
          <div className="package-note error">
            {_i18n.t("当前系统没有可用安装包")}
          </div>
        ) : null}

        {installing ? (
          <div className="loenn-progress">
            <ProgressIndicator
              value={installProgress || 0}
              max={100}
              size={38}
              lineWidth={3}
            />
            <strong>{progressLabel(installState)}</strong>
            <span>{Math.round(installProgress || 0)}%</span>
          </div>
        ) : installState === "failed" ? (
          <div className="install-result failed">
            <Icon name="i-cross" />
            <strong>{_i18n.t("安装失败")}</strong>
            <textarea readOnly value={failedReason || ""} />
            <Button onClick={() => setInstallState(null)}>
              {_i18n.t("返回")}
            </Button>
          </div>
        ) : installState === "success" ? (
          <div className="install-result success">
            <Icon name="i-tick" />
            <strong>{_i18n.t("安装成功")}</strong>
            <Button type="primary" onClick={launch}>
              {_i18n.t("启动 Loenn")}
            </Button>
            <Button onClick={() => setInstallState(null)}>
              {_i18n.t("安装其他版本")}
            </Button>
          </div>
        ) : (
          <div className="install-actions">
            <Button
              type="primary"
              disabled={!selectedPackage}
              onClick={install}
            >
              <Icon name="download" />{" "}
              {localState?.installed
                ? _i18n.t("安装此版本")
                : _i18n.t("安装 Loenn")}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
};
