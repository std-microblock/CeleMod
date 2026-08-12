import { listen } from "@tauri-apps/api/event";
import { loadModCatalog } from "./api/modCatalog";
import { parseCeleModDeepLink } from "./deepLinkParser";
import { installProfileJson, installSingleMod } from "./profileInstall";
import { initializeAppStore, useAppStore } from "./states";
import { callRemote } from "./utils";
import { createPopup, PopupContext } from "./components/Popup";
import { useContext } from "react";

const showDeepLinkError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  createPopup(() => {
    const { hide } = useContext(PopupContext);
    return (
      <div className="popup-content">
        <div className="title">链接处理失败</div>
        <div className="content">{message}</div>
        <div className="buttons">
          <button onClick={hide}>确认</button>
        </div>
      </div>
    );
  });
};

const DEEP_LINK_EVENT = "celemod://open";

const findCatalogMod = async (identifier: string) => {
  const normalized = identifier.toLocaleLowerCase();
  const catalog = await loadModCatalog();
  return catalog.find((mod) => {
    const fileId = mod.submissionFile.gameBananaId;
    const submissionId = mod.submissionFile.submission.gameBananaId;
    return (
      mod.name.toLocaleLowerCase() === normalized ||
      mod.id === identifier ||
      (fileId !== null && String(fileId) === identifier) ||
      (submissionId !== null && String(submissionId) === identifier)
    );
  });
};

export const handleCeleModDeepLink = async (raw: string) => {
  await initializeAppStore();
  const gamePath = useAppStore.getState().gamePath;
  if (!gamePath) throw new Error("请先选择 Celeste 游戏路径");

  const link = parseCeleModDeepLink(raw);
  if (link.type === "add_profile") {
    await installProfileJson(gamePath, link.value, () => {
      useAppStore.getState().setPage("Manage");
    });
    return;
  }

  const mod = await findCatalogMod(link.value);
  if (!mod) throw new Error(`找不到 Mod：${link.value}`);
  await installSingleMod(mod, () => {
    useAppStore.getState().setDownloadMenuOpen(true);
  });
};

let listening: Promise<() => void> | undefined;

export const initializeCeleModDeepLinks = () => {
  if (!("__TAURI_INTERNALS__" in window)) return Promise.resolve(() => {});
  if (listening) return listening;

  let queue = Promise.resolve();
  const enqueue = (urls: string[]) => {
    for (const url of urls) {
      queue = queue
        .then(() => handleCeleModDeepLink(url))
        .catch((error) => {
          console.error("Failed to handle CeleMod deep link", error);
          showDeepLinkError(error);
        });
    }
  };

  listening = listen<string[]>(DEEP_LINK_EVENT, (event) =>
    enqueue(event.payload),
  ).then(async (dispose) => {
    enqueue(await callRemote<string[]>("take_pending_deep_links"));
    return dispose;
  });
  return listening;
};
