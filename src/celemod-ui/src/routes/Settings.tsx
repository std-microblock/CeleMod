import _i18n, { useI18N } from "src/i18n";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { useEnableAcrylic } from "../context/theme";
import {
  FontScale,
  ModPageSource,
  MOD_TYPE_OPTIONS,
  useAppStore,
  useMirror,
  useUseMultiThread,
} from "../states";
import { callRemote } from "../utils";
import { clearInMemoryModCatalog, loadModCatalog } from "../api/modCatalog";
import "./Settings.scss";

interface CacheStatus {
  source: string;
  updatedAt: number;
  count: number;
  path: string;
}

const SettingToggle = ({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) => (
  <label className="setting-toggle-row">
    <span>
      <strong>{title}</strong>
      <small>{description}</small>
    </span>
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  </label>
);

const FONT_SCALE_PRESETS = [100, 110, 125, 150] as const;

const FontScaleSwitch = ({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description: string;
  value: FontScale;
  onChange: (value: FontScale) => void;
}) => {
  const [customSelected, setCustomSelected] = useState(
    !FONT_SCALE_PRESETS.includes(value as (typeof FONT_SCALE_PRESETS)[number])
  );
  const presetSelected = FONT_SCALE_PRESETS.includes(
    value as (typeof FONT_SCALE_PRESETS)[number]
  );
  const showCustom = customSelected || !presetSelected;

  return (
    <div className="font-scale-row">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <div className="font-scale-control">
        <div className="segmented-setting font-scale-segments">
          {FONT_SCALE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={!showCustom && value === preset ? "selected" : ""}
              onClick={() => {
                setCustomSelected(false);
                onChange(preset);
              }}
            >
              {preset}
            </button>
          ))}
          <button
            type="button"
            className={showCustom ? "selected" : ""}
            onClick={() => setCustomSelected(true)}
          >
            {_i18n.t("自定义")}
          </button>
        </div>
        {showCustom && (
          <label className="font-scale-custom">
            <input
              type="number"
              min="50"
              max="200"
              step="1"
              value={value}
              aria-label={_i18n.t("自定义缩放百分比")}
              onChange={(event) => {
                const nextValue = Number(event.target.value);
                if (Number.isFinite(nextValue))
                  onChange(Math.min(200, Math.max(50, Math.round(nextValue))));
              }}
            />
            <span>%</span>
          </label>
        )}
      </div>
    </div>
  );
};

export const Settings = () => {
  const i18n = useI18N();
  const { enableAcrylic, setEnableAcrylic } = useEnableAcrylic();
  const [mirror, setMirror] = useMirror();
  const [useMultiThread, setUseMultiThread] = useUseMultiThread();
  const [downloadAdvanced, setDownloadAdvanced] = useState(false);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheError, setCacheError] = useState("");

  const downloadDefaultEnabled = useAppStore(
    (state) => state.downloadDefaultEnabled
  );
  const downloadTypeDefaults = useAppStore(
    (state) => state.downloadTypeDefaults
  );
  const setDownloadDefaultsAll = useAppStore(
    (state) => state.setDownloadDefaultsAll
  );
  const setDownloadTypeDefault = useAppStore(
    (state) => state.setDownloadTypeDefault
  );
  const checkOptionalDep = useAppStore((state) => state.checkOptionalDep);
  const setCheckOptionalDep = useAppStore((state) => state.setCheckOptionalDep);
  const showUpdate = useAppStore((state) => state.showUpdate);
  const setShowUpdate = useAppStore((state) => state.setShowUpdate);
  const showDetailed = useAppStore((state) => state.showDetailed);
  const setShowDetailed = useAppStore((state) => state.setShowDetailed);
  const modPageSource = useAppStore((state) => state.modPageSource);
  const setModPageSource = useAppStore((state) => state.setModPageSource);
  const autoToggleDependencies = useAppStore(
    (state) => state.autoToggleDependencies
  );
  const setAutoToggleDependencies = useAppStore(
    (state) => state.setAutoToggleDependencies
  );
  const autoToggleOptionalDependencies = useAppStore(
    (state) => state.autoToggleOptionalDependencies
  );
  const setAutoToggleOptionalDependencies = useAppStore(
    (state) => state.setAutoToggleOptionalDependencies
  );
  const deleteOrphansByDefault = useAppStore(
    (state) => state.deleteOrphansByDefault
  );
  const setDeleteOrphansByDefault = useAppStore(
    (state) => state.setDeleteOrphansByDefault
  );
  const hiddenModTypes = useAppStore((state) => state.hiddenModTypes);
  const setHiddenModTypes = useAppStore((state) => state.setHiddenModTypes);
  const modCacheTtlHours = useAppStore((state) => state.modCacheTtlHours);
  const setModCacheTtlHours = useAppStore((state) => state.setModCacheTtlHours);
  const checkBlacklistSync = useAppStore((state) => state.checkBlacklistSync);
  const setCheckBlacklistSync = useAppStore(
    (state) => state.setCheckBlacklistSync
  );
  const fontScale = useAppStore((state) => state.fontScale);
  const setFontScale = useAppStore((state) => state.setFontScale);
  const manageFontScale = useAppStore((state) => state.manageFontScale);
  const setManageFontScale = useAppStore((state) => state.setManageFontScale);
  const keyBindingsFontScale = useAppStore(
    (state) => state.keyBindingsFontScale
  );
  const setKeyBindingsFontScale = useAppStore(
    (state) => state.setKeyBindingsFontScale
  );
  const enablePageTransitions = useAppStore(
    (state) => state.enablePageTransitions
  );
  const setEnablePageTransitions = useAppStore(
    (state) => state.setEnablePageTransitions
  );
  const downloadMode = useMemo(() => {
    const values = MOD_TYPE_OPTIONS.map(
      (type) => downloadTypeDefaults[type] ?? downloadDefaultEnabled
    );
    if (values.every(Boolean)) return "enabled";
    if (values.every((value) => !value)) return "disabled";
    return "advanced";
  }, [downloadDefaultEnabled, downloadTypeDefaults]);

  const refreshCacheStatus = () => {
    void callRemote<CacheStatus>("get_mod_cache_status")
      .then(setCacheStatus)
      .catch((error) => setCacheError(String(error)));
  };

  useEffect(refreshCacheStatus, []);

  const formatCacheTime = (timestamp: number) => {
    if (!timestamp) return _i18n.t("未知");
    return new Intl.DateTimeFormat(i18n.currentLang || undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp));
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <h1>{_i18n.t("设置")}</h1>
        </div>
      </header>

      <div className="settings-columns">
        <section className="settings-section">
          <div className="settings-section-title">
            <Icon name="download" />
            <span>{_i18n.t("下载")}</span>
          </div>
          <div className="settings-card">
            <div className="setting-select-row">
              <span>
                <strong>{_i18n.t("下载镜像")}</strong>
                <small>{_i18n.t("选择 Mod 和 Everest 的下载来源")}</small>
              </span>
              <select
                value={mirror}
                onChange={(event) => setMirror(event.target.value)}
              >
                <option value="0x0ade">0x0ade</option>
                <option value="gamebanana">GameBanana</option>
                <option value="wegfan">WEGFan</option>
              </select>
            </div>
            <SettingToggle
              title={_i18n.t("多线程下载")}
              description={_i18n.t("使用 ureq 并行下载大文件")}
              checked={useMultiThread}
              onChange={setUseMultiThread}
            />

            <div className="download-default-setting">
              <div className="download-default-head">
                <span>
                  <strong>{_i18n.t("Mod 下载后默认行为")}</strong>
                  <small>
                    {_i18n.t("高级：勾选即为默认启用，不勾选即为默认禁用")}
                  </small>
                </span>
                <div className="segmented-setting">
                  <button
                    type="button"
                    className={
                      !downloadAdvanced && downloadMode === "enabled"
                        ? "selected"
                        : ""
                    }
                    onClick={() => {
                      setDownloadDefaultsAll(true);
                      setDownloadAdvanced(false);
                    }}
                  >
                    {_i18n.t("启用")}
                  </button>
                  <button
                    type="button"
                    className={
                      !downloadAdvanced && downloadMode === "disabled"
                        ? "selected"
                        : ""
                    }
                    onClick={() => {
                      setDownloadDefaultsAll(false);
                      setDownloadAdvanced(false);
                    }}
                  >
                    {_i18n.t("禁用")}
                  </button>
                  <button
                    type="button"
                    className={
                      downloadAdvanced || downloadMode === "advanced"
                        ? "selected"
                        : ""
                    }
                    onClick={() => setDownloadAdvanced((value) => !value)}
                  >
                    {_i18n.t("高级")}
                  </button>
                </div>
              </div>
              {(downloadAdvanced || downloadMode === "advanced") && (
                <div className="download-type-grid">
                  {MOD_TYPE_OPTIONS.map((type) => (
                    <label key={type}>
                      <span>{type}</span>
                      <input
                        type="checkbox"
                        checked={
                          downloadTypeDefaults[type] ?? downloadDefaultEnabled
                        }
                        onChange={(event) =>
                          setDownloadTypeDefault(type, event.target.checked)
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">
            <Icon name="drive" />
            <span>{_i18n.t("Mod 管理")}</span>
          </div>
          <div className="settings-card">
            <SettingToggle
              title={_i18n.t("切换 Mod 时同步必要依赖")}
              description={_i18n.t("启用时打开依赖，关闭时关闭不再使用的依赖")}
              checked={autoToggleDependencies}
              onChange={setAutoToggleDependencies}
            />
            {autoToggleDependencies && (
              <SettingToggle
                title={_i18n.t("切换 Mod 时同步可选依赖")}
                description={_i18n.t("仅在同步必要依赖开启时生效")}
                checked={autoToggleOptionalDependencies}
                onChange={setAutoToggleOptionalDependencies}
              />
            )}
            <SettingToggle
              title={_i18n.t("删除时默认勾选孤立依赖")}
              description={_i18n.t("自动选择删除后不再被其他 Mod 依赖的项目")}
              checked={deleteOrphansByDefault}
              onChange={setDeleteOrphansByDefault}
            />
            <SettingToggle
              title={_i18n.t("在树中检查可选依赖")}
              description={_i18n.t("显示可选依赖的缺失、版本和循环关系")}
              checked={checkOptionalDep}
              onChange={setCheckOptionalDep}
            />
            <SettingToggle
              title={_i18n.t("显示可用更新")}
              description={_i18n.t("在管理列表中检查并显示新版本")}
              checked={showUpdate}
              onChange={setShowUpdate}
            />
            <SettingToggle
              title={_i18n.t("显示文件详情")}
              description={_i18n.t("在 Mod 行中显示压缩包名称与大小")}
              checked={showDetailed}
              onChange={setShowDetailed}
            />
            <div className="setting-select-row">
              <span>
                <strong>{_i18n.t("打开 Mod 页面")}</strong>
                <small>
                  {_i18n.t("左键打开所选来源，右键打开另一个来源")}
                </small>
              </span>
              <select
                value={modPageSource}
                onChange={(event) =>
                  setModPageSource(event.target.value as ModPageSource)
                }
              >
                <option value="wegfan">WEGFan</option>
                <option value="gamebanana">GameBanana</option>
              </select>
            </div>
            <SettingToggle
              title={_i18n.t("检查 blacklist.txt 与 Profile 同步")}
              description={_i18n.t(
                "发现 blacklist.txt 被外部修改时提示选择要保留的版本"
              )}
              checked={checkBlacklistSync}
              onChange={setCheckBlacklistSync}
            />

            <div className="hidden-types-setting">
              <strong>{_i18n.t("管理页默认隐藏的类型")}</strong>
              <small>{_i18n.t("仍可在管理页筛选面板中临时显示")}</small>
              <div className="type-chip-grid">
                {MOD_TYPE_OPTIONS.map((type) => {
                  const hidden = hiddenModTypes.includes(type);
                  return (
                    <button
                      type="button"
                      key={type}
                      className={hidden ? "selected" : ""}
                      onClick={() =>
                        setHiddenModTypes(
                          hidden
                            ? hiddenModTypes.filter((value) => value !== type)
                            : [...hiddenModTypes, type]
                        )
                      }
                    >
                      {type}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">
            <Icon name="save" />
            <span>{_i18n.t("Mod 列表缓存")}</span>
          </div>
          <div className="settings-card">
            <div className="setting-select-row cache-ttl-row">
              <span>
                <strong>{_i18n.t("缓存时效")}</strong>
                <small>
                  {_i18n.t("过期后才重新请求完整 Mod 列表；0 表示每次刷新")}
                </small>
              </span>
              <div className="number-with-unit">
                <input
                  type="number"
                  min="0"
                  max="720"
                  value={modCacheTtlHours}
                  onChange={(event) => {
                    const value = Math.max(0, Number(event.target.value) || 0);
                    setModCacheTtlHours(value);
                    void callRemote("configure_mod_cache", value * 60 * 60);
                  }}
                />
                <span>{_i18n.t("小时")}</span>
              </div>
            </div>
            <div className="cache-status">
              <div>
                <span>{_i18n.t("当前来源")}</span>
                <strong>{cacheStatus?.source ?? "--"}</strong>
              </div>
              <div>
                <span>{_i18n.t("记录数")}</span>
                <strong>{cacheStatus?.count ?? "--"}</strong>
              </div>
              <div>
                <span>{_i18n.t("更新时间")}</span>
                <strong>
                  {cacheStatus ? formatCacheTime(cacheStatus.updatedAt) : "--"}
                </strong>
              </div>
            </div>
            {cacheError && <div className="settings-error">{cacheError}</div>}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">
            <Icon name="settings" />
            <span>{_i18n.t("界面")}</span>
          </div>
          <div className="settings-card">
            <SettingToggle
              title={_i18n.t("启用亚克力效果")}
              description={_i18n.t("使用系统窗口模糊和半透明背景")}
              checked={enableAcrylic}
              onChange={setEnableAcrylic}
            />
            <SettingToggle
              title={_i18n.t("页面切换动画")}
              description={_i18n.t("在不同页面之间切换时播放淡入淡出动画")}
              checked={enablePageTransitions}
              onChange={setEnablePageTransitions}
            />
            <FontScaleSwitch
              title={_i18n.t("字体缩放")}
              description={_i18n.t("CeleMod 老年版（不是")}
              value={fontScale}
              onChange={setFontScale}
            />
            <FontScaleSwitch
              title={_i18n.t("管理页字体缩放")}
              description={_i18n.t("单独调整 Mod 管理页面的文字大小")}
              value={manageFontScale}
              onChange={setManageFontScale}
            />
            <FontScaleSwitch
              title={_i18n.t("按键管理页字体缩放")}
              description={_i18n.t("单独调整按键管理页面的文字大小")}
              value={keyBindingsFontScale}
              onChange={setKeyBindingsFontScale}
            />
            <div className="setting-select-row">
              <span>
                <strong>{_i18n.t("语言/Language")}</strong>
                <small>{_i18n.t("切换界面显示语言")}</small>
              </span>
              <select
                value={i18n.currentLang}
                onChange={(event) => {
                  i18n.setLang(event.target.value);
                  setMirror(
                    event.target.value === "zh-CN" ? "wegfan" : "0x0ade"
                  );
                }}
              >
                <option value="zh-CN">{_i18n.t("简体中文")}</option>
                <option value="en-US">English</option>
                <option value="ru-RU">русский</option>
                <option value="pt-BR">Brazilian Portuguese</option>
              </select>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
