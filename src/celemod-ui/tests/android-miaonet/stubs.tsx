// Local synthetic data only. No device/account/network access.
import React, { createContext } from "react";
export default { t: (key: string) => key };
export const enforceEverest = () => null;
export const useGamePath = () => ["/fixture/game"];
export const useAutoDisableNewMods = () => [false];
export const useDownloadStore = (select: (state: unknown) => unknown) => select({ tasks: {}, downloadMod() {} });
export const PopupContext = createContext({ hide() {} });
export const createPopup = () => {};
export const MiaoNetAtlasCanvas = () => <span>图片预览</span>;
export const MiaoNetEmotePicker = () => null;
export const ProgressIndicator = () => <span>正在加载…</span>;

const mode = new URLSearchParams(location.search).get("mode");
let authenticated = !["login", "dropped-callback"].includes(mode ?? "");
let authorization: { state: string; detail?: string; revision: number } | null = null;
let failRead = mode === "error";
const defaults = ["Hi!", "Test emote"];
let settings = {
  connectOnGameStart: false, showAvatar: true, showOwnName: true, playerLight: true,
  playerInteractions: true, enableEmoteWheel: true, playerPresenceMessages: true,
  playerOpacity: 8, playerNameOpacity: 8, offScreenPlayerNameOpacity: 5,
  selfNameOpacity: 10, distanceBasedOpacity: true, minPlayerOpacityMultiplier: 2,
  emoteOpacity: 10, emotes: defaults, defaultEmotes: defaults,
};
export async function invokeCommand(command: string, args: any) {
  switch (command) {
    case "get_miaonet_local_state":
      if (failRead) { failRead = false; throw new Error("模拟读取失败：可重试"); }
      return { installed: true, authenticated, lastName: "测试账号", authorization };
    case "get_miaonet_settings": return structuredClone(settings);
    case "get_miaonet_emote_previews": return [];
    case "save_miaonet_settings":
      if (mode === "save-error") throw new Error("请先退出 Celeste，再修改 MiaoNet 登录信息或设置。");
      settings = { ...structuredClone(args.settings), defaultEmotes: defaults };
      return structuredClone(settings);
    case "logout_miaonet": authenticated = false; return;
    default: throw new Error(`Unexpected fixture command: ${command}`);
  }
}
export async function callRemote(command: string, _path: string, callback: (state: string, detail: string | null, revision: number) => void) {
  if (command !== "start_miaonet_oauth") throw new Error(command);
  authorization = { state: "waiting_browser", revision: (authorization?.revision ?? 0) + 1 };
  callback("waiting_browser", null, authorization.revision);
  setTimeout(() => {
    if (mode === "dropped-callback") {
      // Simulate background/recreated WebView: only the backend snapshot changes.
      authorization = { state: "failed", detail: "模拟后台授权失败：通过状态查询恢复", revision: authorization!.revision + 1 };
      return;
    }
    authenticated = true;
    authorization = { state: "complete", revision: authorization!.revision + 1 };
    callback("complete", null, authorization.revision);
  }, 200);
}
