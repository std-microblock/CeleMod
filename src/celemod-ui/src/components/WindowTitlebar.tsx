import _i18n, { useI18N } from "src/i18n";
import { useEffect, useRef, useState } from "react";
import { callRemote } from "../tauri/commands";
import { detectDesktopPlatform } from "../tauri/window";

export function WindowTitlebar() {
  const titlebarRef = useRef<HTMLElement>(null);
  const [version, setVersion] = useState("");
  const [hash, setHash] = useState("");
  const platform = detectDesktopPlatform();

  useEffect(() => {
    if (platform !== "windows") return;

    let disposed = false;
    const attachControls = () => {
      if (disposed) return true;
      const controls = document.getElementById("tbo-controls");
      const titlebar = titlebarRef.current;
      if (!controls || !titlebar) return false;
      if (controls.parentElement !== titlebar) titlebar.appendChild(controls);
      return true;
    };

    void callRemote("enable_window_controls")
      .then(() => {
        if (attachControls()) return;
        const observer = new MutationObserver(() => {
          if (attachControls()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true });
        window.setTimeout(() => observer.disconnect(), 3000);
      })
      .catch(console.error);

    void Promise.all([
      callRemote<string>("celemod_version"),
      callRemote<string>("celemod_hash"),
    ])
      .then(([nextVersion, nextHash]) => {
        setVersion(nextVersion);
        setHash(nextHash.slice(0, 6));
      })
      .catch(console.error);
    return () => {
      disposed = true;
    };
  }, [platform]);

  if (platform !== "windows") return null;

  return (
    <header
      ref={titlebarRef}
      className="window-titlebar"
      data-tauri-drag-region="deep"
    >
      <div className="window-caption">CeleMod</div>
      <button
        className="celemod-version"
        title={_i18n.t(
          "左键检查更新，右键切换控制台 / Left click to check updates, right click to toggle console",
        )}
        onClick={(event) => {
          if (event.shiftKey) void callRemote("show_log_window");
          else void window._checkUpdate?.();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          void callRemote("show_log_window");
        }}
      >
        <span className="caption-hash">{hash}</span>
        <span className="caption-version">{version}</span>
      </button>
    </header>
  );
}
