import _i18n from "src/i18n";
import { callRemote } from "../utils";
import {
  useGamePath,
  initGamePath,
  initModComments,
  reloadInstalledMods,
} from "../states";
import { useEffect, useContext, useState } from "react";
import { createPopup, PopupContext } from "src/components/Popup";
import { ProgressIndicator } from "src/components/Progress";
import { syncModsWatcher } from "../modsWatcher";

export const createModManageContext = () => {
  initModComments();

  const [gamePath] = useGamePath();
  const [offline, setOffline] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);

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
      return;
    }

    setLoading(true);
    let cancelled = false;
    let popup: ReturnType<typeof createPopup> | undefined;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      popup = createPopup(
        () => (
          <div className="loading-popup">
            <ProgressIndicator infinite />
            <span>{_i18n.t("正在加载 Mod 列表，请稍等")}</span>
            <button
              type="button"
              onClick={() => void skipCatalog().catch(console.error)}
            >
              {_i18n.t("跳过下载，离线继续")}
            </button>
          </div>
        ),
        { cancelable: false },
      );
      (async () => {
        if (!navigator.onLine) await skipCatalog();
        await ctx.reloadMods();
        const isOffline = await callRemote<boolean>("is_catalog_offline");
        if (!cancelled) setOffline(isOffline);
      })()
        .then(() => {
          popup?.hide();
          if (!cancelled) ctx.checkInvalidZipMods();
        })
        .catch((error) => {
          popup?.hide();
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
          if (!cancelled) setLoading(false);
        });
    }, 10);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      popup?.hide();
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
