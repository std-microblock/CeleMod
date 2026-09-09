import _i18n from "../i18n";
import { formatInstallerElapsed, parseAndroidInstallerProgress } from "./installerProgress";
import "./InstallerProgressDetail.scss";

export const InstallerProgressDetail = ({ status }: { status: string | null }) => {
  const progress = parseAndroidInstallerProgress(status);
  if (!progress) return null;
  const stages = [
    _i18n.t("准备 Android 运行环境"),
    _i18n.t("备份原版并准备依赖"),
    _i18n.t("转换游戏与依赖"),
    _i18n.t("应用 FNA 补丁"),
    _i18n.t("应用 Everest 游戏补丁"),
    _i18n.t("生成并修补 Mod 接口"),
    _i18n.t("写入配置并完成安装"),
  ];
  return <div className="android-installer-progress" role="status" aria-live="polite">
    <strong>{progress.stage}/{progress.total} · {stages[progress.stage - 1]}</strong>
    <span>{_i18n.t("安装阶段耗时")} {formatInstallerElapsed(progress.elapsed)}</span>
    <p>{_i18n.t("补丁处理可能需要几分钟，请保持应用在前台。")}</p>
    <pre>{progress.detail}</pre>
  </div>;
};
