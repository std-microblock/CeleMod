import { useCallback, useEffect, useRef, useState } from "react";
import i18n from "../i18n";
import { Icon } from "./Icon";
import { prefersReducedMotion } from "./Motion";

type Destination = { name: string; icon: string; title: string };

export function MobileNavigation({
  page,
  setPage,
  hasGame,
  showLoenn,
  currentLang,
  activeDownloadCount,
}: {
  page: string;
  setPage: (page: string) => void;
  hasGame: boolean;
  showLoenn: boolean;
  currentLang: string;
  activeDownloadCount: number;
}) {
  const sheet = useRef<HTMLDialogElement>(null);
  const closeTimer = useRef<number>();
  const [closing, setClosing] = useState(false);
  const more = currentLang === "zh-CN" ? "更多" : "More";
  const primary: Destination[] = [
    { name: "Home", icon: "home", title: i18n.t("主页") },
    ...(hasGame
      ? [
          { name: "Search", icon: "search", title: i18n.t("搜索") },
          { name: "Manage", icon: "drive", title: i18n.t("管理") },
        ]
      : []),
    { name: "Downloads", icon: "download", title: i18n.t("下载任务") },
  ];
  const secondary: Destination[] = [
    ...(hasGame
      ? [
          { name: "Everest", icon: "chart-area", title: "Everest" },
          { name: "KeyBindings", icon: "keyboard", title: i18n.t("按键") },
          { name: "RecommendMods", icon: "flag", title: i18n.t("推荐模组") },
          ...(currentLang === "zh-CN"
            ? [{ name: "Multiplayer", icon: "web", title: i18n.t("联机相关") }]
            : []),
        ]
      : []),
    ...(showLoenn ? [{ name: "Loenn", icon: "edit", title: "Loenn" }] : []),
    { name: "Settings", icon: "settings", title: i18n.t("设置") },
  ];

  const finishClose = useCallback(() => {
    if (closeTimer.current !== undefined) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
    setClosing(false);
    if (sheet.current?.open) {
      sheet.current.close();
    }
  }, []);

  const closeSheet = useCallback(() => {
    if (!sheet.current?.open || closeTimer.current !== undefined) return;
    if (prefersReducedMotion()) {
      finishClose();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(finishClose, 220);
  }, [finishClose]);

  const openSheet = useCallback(() => {
    if (closeTimer.current !== undefined) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
    setClosing(false);
    if (!sheet.current?.open) {
      sheet.current?.showModal();
    }
  }, []);

  useEffect(() => {
    closeSheet();
  }, [closeSheet, page]);

  useEffect(() => {
    const compact = matchMedia("(max-width: 760px)");
    const onChange = () => closeSheet();
    compact.addEventListener("change", onChange);
    return () => compact.removeEventListener("change", onChange);
  }, [closeSheet]);

  useEffect(() => {
    return () => {
      if (closeTimer.current !== undefined) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
      }
    };
  }, []);

  const destination = ({ name, icon, title }: Destination) => (
    <button
      key={name}
      type="button"
      className={`mobile-nav-button${name === page ? " selected" : ""}`}
      aria-current={name === page ? "page" : undefined}
      onClick={() => {
        closeSheet();
        setPage(name);
      }}
    >
      <span className="mobile-nav-icon">
        <Icon name={icon} />
        {name === "Downloads" && activeDownloadCount > 0 && (
          <span
            className="mobile-nav-badge"
            aria-label={`${activeDownloadCount} ${i18n.t("下载中")}`}
          >
            {activeDownloadCount > 99 ? "99+" : activeDownloadCount}
          </span>
        )}
      </span>
      <span>{title}</span>
    </button>
  );
  return (
    <>
      <nav className="mobile-navigation" aria-label="CeleMod">
        {primary.map(destination)}
        <button
          type="button"
          className={`mobile-nav-button${
            secondary.some((item) => item.name === page) ? " selected" : ""
          }`}
          aria-haspopup="dialog"
          aria-controls="mobile-more"
          onClick={openSheet}
        >
          <span className="mobile-nav-icon">
            <Icon name="opts-h" />
          </span>
          <span>{more}</span>
        </button>
      </nav>
      <dialog
        ref={sheet}
        id="mobile-more"
        className="mobile-more-sheet"
        aria-labelledby="mobile-more-title"
        data-closing={closing ? "true" : undefined}
        onAnimationEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.animationName === "mobile-sheet-exit"
          ) {
            finishClose();
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          closeSheet();
        }}
        onClose={() => {
          if (closeTimer.current !== undefined) {
            window.clearTimeout(closeTimer.current);
            closeTimer.current = undefined;
          }
          setClosing(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const rect = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < rect.left ||
              event.clientX > rect.right ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom
            ) {
              closeSheet();
            }
          }
        }}
      >
        <header>
          <h2 id="mobile-more-title">{more}</h2>
          <button
            type="button"
            aria-label={i18n.t("关闭")}
            onClick={closeSheet}
          >
            <Icon name="i-cross" />
          </button>
        </header>
        <div className="mobile-more-grid">{secondary.map(destination)}</div>
      </dialog>
    </>
  );
}
