import _i18n from "src/i18n";
import { callRemote, sleep } from "../utils";
import {
  useGamePath,
  initGamePath,
  initModComments,
  reloadInstalledMods,
} from "../states";
import { useEffect, useContext, useRef, useState } from "react";
import { createPopup, PopupContext } from "src/components/Popup";
import { syncModsWatcher } from "../modsWatcher";
import { waitForCatalogDownload } from "../catalogDownload";
import { isCatalogDownloading } from "../api/modCatalog";

const STARTUP_LOADING_HINT_DELAY_MS = 600;

export const createModManageContext = () => {
  initModComments();

  const [gamePath] = useGamePath();
  const [offline, setOffline] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(() => Boolean(gamePath));
  const [splashVisible, setSplashVisible] = useState(() => Boolean(gamePath));
  const [loadingSlow, setLoadingSlow] = useState(false);
  const initialLoadSettledRef = useRef(false);

  const skipCatalog = async () => {
    await callRemote("set_catalog_offline", true);
    setOffline(true);
  };

  useEffect(() => {
    const onOffline = () => {
      void skipCatalog().catch(console.error);
    };
    window.addEventListener("offline", onOffline);
    return () => window.removeEventListener("offline", onOffline);
  }, []);

  initGamePath();

  const ctx = {
    offline,
    loading,
    splashVisible,
    loadingSlow,
    skipCatalog,
    retryCatalog: () => {
      setLoading(true);
      void callRemote("set_catalog_offline", false)
        .then(() => {
          setOffline(false);
          setRetry((value) => value + 1);
        })
        .catch((error) => {
          setLoading(false);
          console.error(error);
        });
    },
    reloadMods: () => {
      if (!gamePath) {
        console.warn("game path not set");
        return Promise.reject(new Error("game path not set"));
      }
      return reloadInstalledMods(gamePath).then((mods) => {
        console.log("mod reload finished");
        return mods;
      });
    },
    checkInvalidZipMods: () => {
      if (!gamePath) return;
      callRemote(
        "get_invalid_zip_mod_files",
        gamePath + "/Mods",
        (data: string) => {
          const invalidFiles = JSON.parse(data) as string[];
          if (invalidFiles.length === 0) return;

          createPopup(() => {
            const { hide } = useContext(PopupContext);

            return (
              <div className="popup-content">
                <div className="title">{_i18n.t("发现无效 Mod 压缩包")}</div>
                <div className="content">
                  <p>
                    {_i18n.t(
                      "以下文件不是有效的 zip，继续保留可能导致游戏崩溃：",
                    )}
                  </p>
                  <p>{invalidFiles.join(", ")}</p>
                </div>
                <div className="buttons">
                  <button onClick={hide}>{_i18n.t("暂不处理")}</button>
                  <button
                    onClick={() => {
                      callRemote(
                        "delete_mod_files",
                        gamePath + "/Mods",
                        JSON.stringify(invalidFiles),
                        () => {
                          ctx.reloadMods();
                          hide();
                        },
                      );
                    }}
                  >
                    {_i18n.t("删除这些文件")}
                  </button>
                </div>
              </div>
            );
          });
        },
      );
    },
    gamePath,
    modsPath: gamePath + "/Mods",
  };

  useEffect(() => {
    if (!gamePath) {
      setLoading(false);
      setSplashVisible(false);
      setLoadingSlow(false);
      return;
    }

    setLoading(true);
    setLoadingSlow(false);
    const isInitialStartup = !initialLoadSettledRef.current;
    if (isInitialStartup) {
      setSplashVisible(true);
    }

    let cancelled = false;
    const slowTimer = window.setTimeout(() => {
      if (cancelled) return;
      setLoadingSlow(true);
      setSplashVisible(true);
    }, STARTUP_LOADING_HINT_DELAY_MS);

    (async () => {
      if (!navigator.onLine) await skipCatalog();
      await ctx.reloadMods();
      const isOffline = await callRemote<boolean>("is_catalog_offline");
      if (!cancelled) setOffline(isOffline);
      // A slow connection can still be downloading the catalog after the
      // first screen stopped waiting for it: refresh the Mod list once it
      // lands instead of leaving the Mod metadata missing.
      if (!isOffline && (await isCatalogDownloading())) {
        void waitForCatalogDownload(isCatalogDownloading, sleep).then(
          (settled) => {
            if (settled && !cancelled) {
              void ctx.reloadMods().catch(console.error);
            }
          },
        );
      }
    })()
      .then(() => {
        if (!cancelled) ctx.checkInvalidZipMods();
      })
      .catch((error) => {
        if (cancelled) return;
        const errorPopup = createPopup(() => (
          <div className="popup-content">
            <div className="title">{_i18n.t("加载 Mod 列表失败")}</div>
            <div className="content">
              <p>{_i18n.t("请检查游戏路径是否正确，或网络连接是否正常")}</p>
              <p>{_i18n.t("部分功能将不可用")}</p>
              <p>{String(error)}</p>
            </div>
            <div className="buttons">
              <button onClick={() => errorPopup.hide()}>
                {_i18n.t("确定")}
              </button>
            </div>
          </div>
        ));
      })
      .finally(() => {
        window.clearTimeout(slowTimer);
        if (!cancelled) {
          initialLoadSettledRef.current = true;
          setSplashVisible(false);
          setLoadingSlow(false);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
    };
  }, [gamePath, retry]);

  // Watch the Mods folder so Mods installed outside of CeleMod (Everest, the
  // game itself, manual copies) show up without a manual reload.
  useEffect(() => {
    void syncModsWatcher(gamePath).catch((error) => {
      console.error("Failed to configure the Mods folder watcher", error);
    });
  }, [gamePath]);

  return ctx;
};
