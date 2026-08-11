import _i18n from "src/i18n";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  FaArrowUpRightFromSquare,
  FaCircleExclamation,
  FaCloudArrowDown,
  FaFloppyDisk,
  FaFont,
  FaGamepad,
  FaImage,
  FaLock,
  FaPlus,
  FaRotateLeft,
  FaTrashCan,
} from "react-icons/fa6";

import { enforceEverest } from "../components/EnforceEverestPage";
import {
  MiaoNetAtlasCanvas,
  MiaoNetEmotePicker,
  type MiaoNetAtlasPreview,
} from "../components/MiaoNetEmotePicker";
import { createPopup, PopupContext } from "../components/Popup";
import { useAutoDisableNewMods, useGamePath } from "../states";
import { useDownloadStore } from "../stores/download";
import { invokeCommand } from "../tauri/commands";
import { callRemote } from "../utils";
import "./Multiplayer.scss";
import { ProgressIndicator } from "src/components/Progress";

type LocalState = {
  installed: boolean;
  authenticated: boolean;
  lastName?: string | null;
};

type MiaoNetSettings = {
  connectOnGameStart: boolean;
  showAvatar: boolean;
  showOwnName: boolean;
  playerLight: boolean;
  playerInteractions: boolean;
  enableEmoteWheel: boolean;
  playerPresenceMessages: boolean;
  playerOpacity: number;
  playerNameOpacity: number;
  offScreenPlayerNameOpacity: number;
  selfNameOpacity: number;
  distanceBasedOpacity: boolean;
  minPlayerOpacityMultiplier: number;
  emoteOpacity: number;
  emotes: string[];
  defaultEmotes: string[];
};

type MiaoNetSettingsUpdate = Omit<MiaoNetSettings, "defaultEmotes">;

const cloneMiaoNetSettings = (settings: MiaoNetSettings): MiaoNetSettings => ({
  ...settings,
  emotes: [...settings.emotes],
  defaultEmotes: [...settings.defaultEmotes],
});

const toMiaoNetSettingsUpdate = ({
  defaultEmotes: _defaultEmotes,
  ...settings
}: MiaoNetSettings): MiaoNetSettingsUpdate => settings;


type AuthorizationState =
  | "idle"
  | "starting"
  | "waiting_browser"
  | "exchanging_code"
  | "saving_token"
  | "failed";

const miaoNetDownloadUrl =
  "https://celeste.weg.fan/api/v2/download/mods/MiaoNet";

const MultiplayerFrame = ({
  step,
  settings = false,
  children,
}: {
  step: string;
  settings?: boolean;
  children: ReactNode;
}) => (
  <div
    className={`multiplayer-page${settings ? " multiplayer-page-settings" : ""}`}
  >
    <header className="multiplayer-page-header">
      <div className="multiplayer-page-title">
        <FaGamepad />
        <h1>{_i18n.t("群服联机")}</h1>
      </div>
      <span>{step}</span>
    </header>
    <div
      className={
        settings
          ? "multiplayer-page-body multiplayer-settings-body"
          : "multiplayer-page-body multiplayer-centered"
      }
    >
      {children}
    </div>
  </div>
);

export const Multiplayer = () => {
  const noEverest = enforceEverest();
  const [gamePath] = useGamePath();
  const [autoDisableNewMods] = useAutoDisableNewMods();
  const [localState, setLocalState] = useState<LocalState | null>(null);
  const [authorizationState, setAuthorizationState] =
    useState<AuthorizationState>("idle");
  const [authorizationError, setAuthorizationError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [miaoNetSettings, setMiaoNetSettings] =
    useState<MiaoNetSettings | null>(null);
  const [savedMiaoNetSettings, setSavedMiaoNetSettings] =
    useState<MiaoNetSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsNotice, setSettingsNotice] = useState("");
  const [emotePreviews, setEmotePreviews] = useState<
    Record<number, MiaoNetAtlasPreview>
  >({});
  const [editingTextIndex, setEditingTextIndex] = useState<number | null>(null);
  const [draggedEmoteIndex, setDraggedEmoteIndex] = useState<number | null>(null);
  const [dragOverEmoteIndex, setDragOverEmoteIndex] = useState<number | null>(null);
  const [emoteDragOffset, setEmoteDragOffset] = useState({ x: 0, y: 0 });
  const emotePreviewRequest = useRef(0);
  const draggedEmoteIndexRef = useRef<number | null>(null);
  const dragOverEmoteIndexRef = useRef<number | null>(null);
  const emoteDragStartRef = useRef({ x: 0, y: 0 });
  const emoteCardRectsRef = useRef<DOMRect[]>([]);
  const downloadMod = useDownloadStore((state) => state.downloadMod);
  const downloadTask = useDownloadStore((state) => state.tasks.MiaoNet);

  const refreshLocalState = useCallback(async () => {
    if (!gamePath) return;
    try {
      const state = await invokeCommand<LocalState>("get_miaonet_local_state", {
        gamePath,
      });
      setLocalState(state);
    } catch (error) {
      console.error(error);
    }
  }, [gamePath]);

  const refreshMiaoNetSettings = useCallback(async () => {
    if (!gamePath) return;
    setSettingsLoading(true);
    setSettingsError("");
    try {
      const settings = await invokeCommand<MiaoNetSettings>(
        "get_miaonet_settings",
        { gamePath }
      );
      setMiaoNetSettings(cloneMiaoNetSettings(settings));
      setSavedMiaoNetSettings(cloneMiaoNetSettings(settings));
    } catch (error) {
      setSettingsError(String(error));
    } finally {
      setSettingsLoading(false);
    }
  }, [gamePath]);

  useEffect(() => {
    void refreshLocalState();
    const timer = window.setInterval(refreshLocalState, 2200);
    return () => window.clearInterval(timer);
  }, [refreshLocalState]);

  useEffect(() => {
    if (!localState?.authenticated) {
      setMiaoNetSettings(null);
      setSavedMiaoNetSettings(null);
      setSettingsNotice("");
      return;
    }
    void refreshMiaoNetSettings();
  }, [localState?.authenticated, refreshMiaoNetSettings]);

  useEffect(() => {
    const emotes = miaoNetSettings?.emotes;
    if (!emotes) {
      setEmotePreviews({});
      return;
    }
    const request = ++emotePreviewRequest.current;
    const timer = window.setTimeout(() => {
      void invokeCommand<Array<MiaoNetAtlasPreview & { index: number }>>(
        "get_miaonet_emote_previews",
        {
          gamePath,
          emotes,
        }
      )
        .then((loaded) => {
          if (request !== emotePreviewRequest.current) return;
          setEmotePreviews(
            Object.fromEntries(loaded.map((preview) => [preview.index, preview]))
          );
        })
        .catch((error) => console.error("Failed to load MiaoNet emotes", error));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [gamePath, miaoNetSettings?.emotes]);

  const installMiaoNet = useCallback(() => {
    downloadMod("MiaoNet", miaoNetDownloadUrl, {
      force: Boolean(downloadTask),
      ownerId: "miaonet-setup",
      autoDisableNewMods,
      onFinished: () => window.setTimeout(refreshLocalState, 350),
    });
  }, [autoDisableNewMods, downloadMod, downloadTask, refreshLocalState]);

  const openAuthorization = useCallback(async () => {
    setAuthorizationState("starting");
    setAuthorizationError("");
    try {
      await callRemote(
        "start_miaonet_oauth",
        gamePath,
        (state: unknown, detail: unknown) => {
          const nextState = String(state);
          if (nextState === "complete") {
            void refreshLocalState();
            return;
          }
          if (nextState === "failed") {
            setAuthorizationState("failed");
            setAuthorizationError(
              String(detail || _i18n.t("授权未完成，请重试。"))
            );
            return;
          }
          if (
            nextState === "waiting_browser" ||
            nextState === "exchanging_code" ||
            nextState === "saving_token"
          ) {
            setAuthorizationState(nextState);
          }
        }
      );
    } catch (error) {
      setAuthorizationState("failed");
      setAuthorizationError(String(error));
    }
  }, [gamePath, refreshLocalState]);

  const logout = useCallback(async () => {
    setLoggingOut(true);
    setLogoutError("");
    try {
      await invokeCommand("logout_miaonet", { gamePath });
      setAuthorizationState("idle");
      setAuthorizationError("");
      setLocalState((state) =>
        state
          ? {
              ...state,
              authenticated: false,
              lastName: null,
            }
          : state
      );
      await refreshLocalState();
    } catch (error) {
      setLogoutError(String(error));
    } finally {
      setLoggingOut(false);
    }
  }, [gamePath, refreshLocalState]);

  const updateMiaoNetSetting = <K extends keyof MiaoNetSettingsUpdate,>(
    key: K,
    value: MiaoNetSettingsUpdate[K]
  ) => {
    setMiaoNetSettings((current) =>
      current ? { ...current, [key]: value } : current
    );
    setSettingsNotice("");
  };

  const updateEmote = (index: number, value: string) => {
    setMiaoNetSettings((current) => {
      if (!current) return current;
      const emotes = [...current.emotes];
      emotes[index] = value;
      return { ...current, emotes };
    });
    setSettingsNotice("");
  };

  const openEmotePicker = (target: number | "append") => {
    const PickerPopup = () => {
      const { hide } = useContext(PopupContext);
      return (
        <MiaoNetEmotePicker
          gamePath={gamePath}
          onClose={hide}
          onSelect={(expression) => {
            if (target === "append") {
              setMiaoNetSettings((current) =>
                current
                  ? { ...current, emotes: [...current.emotes, expression] }
                  : current
              );
              setSettingsNotice("");
            } else {
              updateEmote(target, expression);
            }
            hide();
          }}
        />
      );
    };
    createPopup(PickerPopup, {
      backgroundMask: "transparent",
      className: "miaonet-atlas-popup-container",
    });
  };

  const reorderEmote = (sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex) return;
    setMiaoNetSettings((current) => {
      if (!current) return current;
      const emotes = [...current.emotes];
      const [moved] = emotes.splice(sourceIndex, 1);
      emotes.splice(targetIndex, 0, moved);
      return { ...current, emotes };
    });
    setEmotePreviews((current) => {
      const reordered: Record<number, MiaoNetAtlasPreview> = {};
      for (const [rawIndex, preview] of Object.entries(current)) {
        const index = Number(rawIndex);
        const nextIndex =
          index === sourceIndex
            ? targetIndex
            : sourceIndex < targetIndex &&
              index > sourceIndex &&
              index <= targetIndex
            ? index - 1
            : sourceIndex > targetIndex &&
              index >= targetIndex &&
              index < sourceIndex
            ? index + 1
            : index;
        reordered[nextIndex] = preview;
      }
      return reordered;
    });
    setEditingTextIndex(null);
    setSettingsNotice("");
  };

  const clearEmoteDrag = () => {
    draggedEmoteIndexRef.current = null;
    dragOverEmoteIndexRef.current = null;
    emoteCardRectsRef.current = [];
    setDraggedEmoteIndex(null);
    setDragOverEmoteIndex(null);
    setEmoteDragOffset({ x: 0, y: 0 });
  };

  const updateEmoteDragTarget = (event: ReactPointerEvent<HTMLElement>) => {
    if (draggedEmoteIndexRef.current === null) return;
    event.preventDefault();
    setEmoteDragOffset({
      x: event.clientX - emoteDragStartRef.current.x,
      y: event.clientY - emoteDragStartRef.current.y,
    });

    let targetIndex = draggedEmoteIndexRef.current;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const [index, rect] of emoteCardRectsRef.current.entries()) {
      const distanceX =
        event.clientX < rect.left
          ? rect.left - event.clientX
          : event.clientX > rect.right
          ? event.clientX - rect.right
          : 0;
      const distanceY =
        event.clientY < rect.top
          ? rect.top - event.clientY
          : event.clientY > rect.bottom
          ? event.clientY - rect.bottom
          : 0;
      const distance = distanceX * distanceX + distanceY * distanceY;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        targetIndex = index;
      }
    }
    if (dragOverEmoteIndexRef.current === targetIndex) return;
    dragOverEmoteIndexRef.current = targetIndex;
    setDragOverEmoteIndex(targetIndex);
  };

  const getEmoteDragStyle = (index: number): CSSProperties | undefined => {
    if (draggedEmoteIndex === null || dragOverEmoteIndex === null) return;
    if (index === draggedEmoteIndex) {
      return {
        zIndex: 4,
        transform: `translate3d(${emoteDragOffset.x}px, ${emoteDragOffset.y}px, 0) scale(1.025)`,
        transition: "none",
      };
    }

    let destinationIndex = index;
    if (
      draggedEmoteIndex < dragOverEmoteIndex &&
      index > draggedEmoteIndex &&
      index <= dragOverEmoteIndex
    ) {
      destinationIndex = index - 1;
    } else if (
      draggedEmoteIndex > dragOverEmoteIndex &&
      index >= dragOverEmoteIndex &&
      index < draggedEmoteIndex
    ) {
      destinationIndex = index + 1;
    }
    if (destinationIndex === index) return;
    const from = emoteCardRectsRef.current[index];
    const to = emoteCardRectsRef.current[destinationIndex];
    if (!from || !to) return;
    return {
      transform: `translate3d(${to.left - from.left}px, ${to.top - from.top}px, 0)`,
    };
  };

  const finishEmoteDrag = (
    event: ReactPointerEvent<HTMLElement>,
    commit: boolean
  ) => {
    const sourceIndex = draggedEmoteIndexRef.current;
    const targetIndex = dragOverEmoteIndexRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clearEmoteDrag();
    if (commit && sourceIndex !== null && targetIndex !== null) {
      reorderEmote(sourceIndex, targetIndex);
    }
  };

  const removeEmote = (index: number) => {
    setMiaoNetSettings((current) =>
      current
        ? {
            ...current,
            emotes: current.emotes.filter((_, emoteIndex) => emoteIndex !== index),
          }
        : current
    );
    setEditingTextIndex(null);
    clearEmoteDrag();
    setSettingsNotice("");
  };
  const saveMiaoNetSettings = async () => {
    if (!miaoNetSettings) return;
    setSettingsSaving(true);
    setSettingsError("");
    setSettingsNotice("");
    try {
      const settings = toMiaoNetSettingsUpdate(miaoNetSettings);
      const saved = await invokeCommand<MiaoNetSettings>(
        "save_miaonet_settings",
        { gamePath, settings }
      );
      setMiaoNetSettings(cloneMiaoNetSettings(saved));
      setSavedMiaoNetSettings(cloneMiaoNetSettings(saved));
      setSettingsNotice(_i18n.t("设置已保存，重新进入游戏后生效。"));
    } catch (error) {
      setSettingsError(String(error));
    } finally {
      setSettingsSaving(false);
    }
  };

  const settingsDirty = Boolean(
    miaoNetSettings &&
      savedMiaoNetSettings &&
      JSON.stringify(toMiaoNetSettingsUpdate(miaoNetSettings)) !==
        JSON.stringify(toMiaoNetSettingsUpdate(savedMiaoNetSettings))
  );

  if (noEverest) return noEverest;

  if (!localState) {
    return (
      <MultiplayerFrame step={_i18n.t("正在检查本地状态")}>
        <ProgressIndicator infinite />
        <strong>{_i18n.t("正在检查联机配置…")}</strong>
      </MultiplayerFrame>
    );
  }

  if (!localState.installed) {
    const downloading = downloadTask?.state === "pending";
    const failed = downloadTask?.state === "failed";
    return (
      <MultiplayerFrame step={_i18n.t("步骤 1 / 2 · 安装 MiaoNet+")}>
        <div className={`multiplayer-state-icon ${failed ? "error" : ""}`}>
          {failed ? <FaCircleExclamation /> : <FaCloudArrowDown />}
        </div>
        <strong>
          {failed
            ? _i18n.t("MiaoNet+ 下载失败")
            : downloading
            ? _i18n.t("正在安装 MiaoNet+")
            : _i18n.t("需要安装 MiaoNet+")}
        </strong>
        <span className="multiplayer-state-description">
          {failed
            ? downloadTask?.error ||
              _i18n.t("安装未完成，请检查网络连接后重试。")
            : downloading
            ? _i18n.t("正在下载并安装到当前 Celeste 的 Mods 文件夹。")
            : _i18n.t("点击下方按钮后才会开始下载联机组件。")}
        </span>
        {downloading && (
          <div className="multiplayer-download-progress">
            <span style={{ width: `${downloadTask?.progress ?? 0}%` }} />
          </div>
        )}
        {downloading && (
          <small>{Math.round(downloadTask?.progress ?? 0)}%</small>
        )}
        {!downloading && (
          <button
            type="button"
            className="multiplayer-install"
            onClick={installMiaoNet}
          >
            {failed ? _i18n.t("重试安装") : _i18n.t("安装 MiaoNet+")}
          </button>
        )}
      </MultiplayerFrame>
    );
  }

  if (localState.authenticated) {
    if (settingsLoading && !miaoNetSettings) {
      return (
        <MultiplayerFrame step={_i18n.t("联机设置")} settings>
          <div className="multiplayer-settings-loading">
            <ProgressIndicator infinite />
            <strong>{_i18n.t("正在读取 MiaoNet 设置…")}</strong>
          </div>
        </MultiplayerFrame>
      );
    }

    if (!miaoNetSettings) {
      return (
        <MultiplayerFrame step={_i18n.t("联机设置")} settings>
          <div className="multiplayer-settings-loading error">
            <FaCircleExclamation />
            <strong>{_i18n.t("无法读取 MiaoNet 设置")}</strong>
            <span>{settingsError}</span>
            <button type="button" onClick={refreshMiaoNetSettings}>
              {_i18n.t("重试")}
            </button>
          </div>
        </MultiplayerFrame>
      );
    }

    const booleanSettings = [
      {
        key: "connectOnGameStart",
        label: _i18n.t("启动游戏时自动连接"),
        description: _i18n.t("进入 Celeste 后自动连接群服。"),
      },
      {
        key: "showAvatar",
        label: _i18n.t("显示玩家头像"),
        description: _i18n.t("在玩家列表和联机界面显示论坛头像。"),
      },
      {
        key: "showOwnName",
        label: _i18n.t("显示自己的名字"),
        description: _i18n.t("在自己的角色上方显示名称。"),
      },
      {
        key: "playerLight",
        label: _i18n.t("玩家光照"),
        description: _i18n.t("让联机玩家受到场景光照影响。"),
      },
      {
        key: "distanceBasedOpacity",
        label: _i18n.t("玩家近距离透明"),
        description: _i18n.t("距离越近，其他玩家越透明，避免遮挡角色和机关。"),
      },
      {
        key: "playerInteractions",
        label: _i18n.t("玩家互动"),
        description: _i18n.t("允许与其他联机玩家产生互动效果。"),
      },
      {
        key: "playerPresenceMessages",
        label: _i18n.t("玩家进出提示"),
        description: _i18n.t("显示玩家加入或离开频道的消息。"),
      },
      {
        key: "enableEmoteWheel",
        label: _i18n.t("启用表情轮盘"),
        description: _i18n.t("使用手柄右摇杆打开并发送表情。"),
      },
    ] as const;

    const opacitySettings = [
      {
        key: "playerOpacity",
        min: 1,
        max: 10,
        label: _i18n.t("玩家透明度"),
        description: _i18n.t("控制其他玩家角色的基础透明度。"),
      },
      {
        key: "playerNameOpacity",
        min: 1,
        max: 10,
        label: _i18n.t("玩家名称透明度"),
        description: _i18n.t("控制其他玩家名称的透明度。"),
      },
      {
        key: "selfNameOpacity",
        min: 1,
        max: 10,
        label: _i18n.t("自己名称透明度"),
        description: _i18n.t("控制自己角色名称的透明度。"),
      },
      {
        key: "offScreenPlayerNameOpacity",
        min: 0,
        max: 10,
        label: _i18n.t("屏幕外玩家名称透明度"),
        description: _i18n.t("控制屏幕边缘方向提示名称的透明度。"),
      },
      {
        key: "minPlayerOpacityMultiplier",
        min: 0,
        max: 9,
        label: _i18n.t("最小玩家不透明度倍率"),
        description: _i18n.t("近距离透明启用时，限制玩家最低可见程度。"),
        disabled: !miaoNetSettings.distanceBasedOpacity,
      },
      {
        key: "emoteOpacity",
        min: 1,
        max: 10,
        label: _i18n.t("表情透明度"),
        description: _i18n.t("控制所有玩家头顶表情的显示透明度。"),
      },
    ] as const;

    const emoteKeyCounts = new Map<string, number>();
    const emoteRenderKeys = miaoNetSettings.emotes.map((emote) => {
      const occurrence = emoteKeyCounts.get(emote) ?? 0;
      emoteKeyCounts.set(emote, occurrence + 1);
      return `${emote}\u0000${occurrence}`;
    });

    return (
      <MultiplayerFrame step={_i18n.t("联机设置")} settings>
        <div className="multiplayer-dashboard">
          <section className="multiplayer-account-card">
            <div>
              <strong>{_i18n.t("群服联机已配置")}</strong>
              <div className="multiplayer-local-summary">
                <span>{_i18n.t("Mod 已安装")}</span>
                <span>
                  {_i18n.t("已登录 ·")}
                  {localState.lastName || _i18n.t("未知账号")}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="multiplayer-logout"
              disabled={loggingOut}
              onClick={logout}
            >
              {loggingOut ? _i18n.t("正在退出…") : _i18n.t("退出登录")}
            </button>
          </section>

          {logoutError && (
            <div className="multiplayer-settings-message error">{logoutError}</div>
          )}

          <section className="multiplayer-settings-card">
            <header>
              <div>
                <h2>{_i18n.t("常用设置")}</h2>
                <p>{_i18n.t("管理 MiaoNet 的连接、显示与互动选项。")}</p>
              </div>
              <span className={settingsDirty ? "dirty" : ""}>
                {settingsDirty ? _i18n.t("有未保存更改") : _i18n.t("已保存")}
              </span>
            </header>
            <div className="multiplayer-toggle-grid">
              {booleanSettings.map((option) => (
                <label key={option.key} className="multiplayer-toggle-row">
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={miaoNetSettings[option.key]}
                    onChange={(event) =>
                      updateMiaoNetSetting(option.key, event.target.checked)
                    }
                  />
                </label>
              ))}
            </div>
            <div className="multiplayer-range-settings">
              {opacitySettings.map((option) => (
                <label
                  key={option.key}
                  className={`multiplayer-opacity-setting${
                    "disabled" in option && option.disabled ? " disabled" : ""
                  }`}
                >
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  <div>
                    <input
                      type="range"
                      min={option.min}
                      max={option.max}
                      disabled={"disabled" in option && option.disabled}
                      value={miaoNetSettings[option.key]}
                      onChange={(event) =>
                        updateMiaoNetSetting(
                          option.key,
                          Number(event.target.value)
                        )
                      }
                    />
                    <output>{miaoNetSettings[option.key] * 10}%</output>
                  </div>
                </label>
              ))}
            </div>
          </section>

          <section className="multiplayer-settings-card multiplayer-emotes-card">
            <header>
              <div>
                <h2>{_i18n.t("表情包管理")}</h2>
              </div>
              <span>
                {_i18n.t("{count} 个表情", {
                  count: miaoNetSettings.emotes.length,
                })}
              </span>
            </header>

            <div className="multiplayer-emote-grid">
              {miaoNetSettings.emotes.length === 0 && (
                <div className="multiplayer-emote-empty">
                  {_i18n.t("当前没有表情")}
                </div>
              )}
              {miaoNetSettings.emotes.map((emote, index) => {
                const imageEmote = /^[pig]\d*:/i.test(emote.trim());
                return (
                  <article
                    className={`multiplayer-emote-card${
                      draggedEmoteIndex === index ? " dragging" : ""
                    }${dragOverEmoteIndex === index ? " drag-over" : ""}`}
                    data-emote-index={index}
                    key={emoteRenderKeys[index]}
                    style={getEmoteDragStyle(index)}
                    onPointerDown={(event) => {
                      if (
                        event.button !== 0 ||
                        editingTextIndex === index ||
                        (event.target instanceof Element &&
                          event.target.closest("button, textarea, input, select, a"))
                      ) {
                        return;
                      }
                      emoteDragStartRef.current = {
                        x: event.clientX,
                        y: event.clientY,
                      };
                      emoteCardRectsRef.current = Array.from(
                        event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                          ".multiplayer-emote-card"
                        ) ?? []
                      ).map((card) => card.getBoundingClientRect());
                      draggedEmoteIndexRef.current = index;
                      dragOverEmoteIndexRef.current = index;
                      setDraggedEmoteIndex(index);
                      setDragOverEmoteIndex(index);
                      event.currentTarget.setPointerCapture(event.pointerId);
                      event.preventDefault();
                    }}
                    onPointerMove={updateEmoteDragTarget}
                    onPointerUp={(event) => finishEmoteDrag(event, true)}
                    onPointerCancel={(event) => finishEmoteDrag(event, false)}
                  >
                    <div className="multiplayer-emote-preview">
                      <span className="multiplayer-emote-index">{index + 1}</span>
                      {editingTextIndex === index ? (
                        <textarea
                          autoFocus
                          value={emote}
                          placeholder={_i18n.t("输入表情文本")}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => updateEmote(index, event.target.value)}
                          onBlur={() => setEditingTextIndex(null)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape" || (event.ctrlKey && event.key === "Enter")) {
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      ) : imageEmote ? (
                        emotePreviews[index] ? (
                          <MiaoNetAtlasCanvas preview={emotePreviews[index]} />
                        ) : (
                          <div className="multiplayer-emote-image-fallback">
                            <FaImage />
                            <span>{emote}</span>
                          </div>
                        )
                      ) : (
                        <div className="multiplayer-emote-text-preview">
                          {emote || _i18n.t("空文本")}
                        </div>
                      )}
                    </div>
                    <div className="multiplayer-emote-actions">
                      <button
                        type="button"
                        onClick={() => openEmotePicker(index)}
                      >
                        <FaImage />
                        {_i18n.t("图片")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingTextIndex(index)}
                      >
                        <FaFont />
                        {_i18n.t("文本")}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => removeEmote(index)}
                      >
                        <FaTrashCan />
                        {_i18n.t("删除")}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="multiplayer-emote-footer">
              <button
                type="button"
                onClick={() => {
                  const index = miaoNetSettings.emotes.length;
                  setMiaoNetSettings((current) =>
                    current
                      ? { ...current, emotes: [...current.emotes, ""] }
                      : current
                  );
                  setEditingTextIndex(index);
                  setSettingsNotice("");
                }}
              >
                <FaPlus />
                {_i18n.t("添加文本")}
              </button>
              <button
                type="button"
                onClick={() => openEmotePicker("append")}
              >
                <FaImage />
                {_i18n.t("添加图片")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMiaoNetSettings((current) =>
                    current
                      ? { ...current, emotes: [...current.defaultEmotes] }
                      : current
                  );
                  setEditingTextIndex(null);
                  setSettingsNotice("");
                }}
              >
                <FaRotateLeft />
                {_i18n.t("恢复默认表情")}
              </button>
            </div>
          </section>

          {(settingsError || settingsNotice) && (
            <div
              className={`multiplayer-settings-message${
                settingsError ? " error" : " success"
              }`}
            >
              {settingsError || settingsNotice}
            </div>
          )}

          <footer className="multiplayer-settings-footer">
            <button
              type="button"
              disabled={!settingsDirty || settingsSaving}
              onClick={() => {
                if (!savedMiaoNetSettings) return;
                setMiaoNetSettings(cloneMiaoNetSettings(savedMiaoNetSettings));
                setSettingsError("");
                setSettingsNotice("");
              }}
            >
              {_i18n.t("放弃更改")}
            </button>
            <button
              type="button"
              className="primary"
              disabled={!settingsDirty || settingsSaving}
              onClick={saveMiaoNetSettings}
            >
              <FaFloppyDisk />
              {settingsSaving ? _i18n.t("正在保存…") : _i18n.t("保存设置")}
            </button>
          </footer>
        </div>
      </MultiplayerFrame>
    );
  }

  return (
    <MultiplayerFrame step={_i18n.t("步骤 2 / 2 · 登录并授权")}>
      <div className="multiplayer-state-icon">
        <FaLock />
      </div>
      <strong>{_i18n.t("在浏览器中完成授权")}</strong>
      <span className="multiplayer-state-description multiplayer-auth-description">
        {_i18n.t(
          "点击下方按钮后会打开论坛授权页面。请在页面中完成注册/登录和授权。"
        )}
      </span>
      <button
        type="button"
        className="multiplayer-authorize"
        disabled={
          authorizationState !== "idle" && authorizationState !== "failed"
        }
        onClick={openAuthorization}
      >
        <FaArrowUpRightFromSquare />
        {authorizationState === "starting"
          ? _i18n.t("正在准备授权…")
          : authorizationState === "waiting_browser"
          ? _i18n.t("等待浏览器授权…")
          : authorizationState === "exchanging_code"
          ? _i18n.t("正在验证账号…")
          : authorizationState === "saving_token"
          ? _i18n.t("正在保存登录信息…")
          : authorizationState === "failed"
          ? _i18n.t("重新开始授权")
          : _i18n.t("打开系统浏览器授权")}
      </button>
      {authorizationState !== "idle" && authorizationState !== "failed" && (
        <span className="multiplayer-waiting">
          {authorizationState === "waiting_browser"
            ? _i18n.t("请在系统浏览器中完成注册、登录和授权。")
            : _i18n.t("授权已收到，请稍候…")}
        </span>
      )}
      {authorizationError && (
        <span className="multiplayer-auth-error">{authorizationError}</span>
      )}
    </MultiplayerFrame>
  );
};
