import _i18n, { useI18N } from "src/i18n";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  FaArrowUpRightFromSquare,
  FaCheck,
  FaCircleExclamation,
  FaCloudArrowDown,
  FaGamepad,
  FaLock,
} from "react-icons/fa6";

import { enforceEverest } from "../components/EnforceEverestPage";
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
  children,
}: {
  step: string;
  children: ReactNode;
}) => (
  <div className="multiplayer-page">
    <header className="multiplayer-page-header">
      <h1>{_i18n.t("群服联机")}</h1>
      <span>{step}</span>
    </header>
    <div className="multiplayer-page-body multiplayer-centered">{children}</div>
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

  useEffect(() => {
    void refreshLocalState();
    const timer = window.setInterval(refreshLocalState, 2200);
    return () => window.clearInterval(timer);
  }, [refreshLocalState]);

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
    return (
      <MultiplayerFrame step={_i18n.t("配置完成")}>
        <div className="multiplayer-state-icon complete">
          <FaCheck />
        </div>
        <strong>{_i18n.t("群服联机已配置")}</strong>
        <div className="multiplayer-local-summary">
          <span>
            <FaCheck />
            {_i18n.t("Mod 已安装")}
          </span>
          <span>
            <FaLock />
            {_i18n.t("已登录 ·")}
            {localState.lastName}
          </span>
        </div>
        <button
          type="button"
          className="multiplayer-logout"
          disabled={loggingOut}
          onClick={logout}
        >
          {loggingOut ? _i18n.t("正在退出…") : _i18n.t("退出登录")}
        </button>
        {logoutError && (
          <span className="multiplayer-logout-error">{logoutError}</span>
        )}
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
