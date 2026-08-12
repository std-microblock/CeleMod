import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import _i18n, { createI18NContext } from "./i18n";
import { Icon } from "./components/Icon";
import { Search } from "./routes/Search";
import { Home } from "./routes/Home";
import { Manage } from "./routes/Manage";
import { Multiplayer } from "./routes/Multiplayer";
import { EventTarget } from "./utils";
import { RecommendMods } from "./routes/RecommendMods";
import {
  useAppStore,
  useCurrentLang,
  useGamePath,
  useInitializeAppStore,
} from "./states";
import { createModManageContext } from "./context/modManage";
import { DownloadListMenu } from "./components/DownloadList";
import { useEverestCtx as createEverestContext } from "./context/everest";
import { Everest } from "./routes/Everest";
import { checkUpdate } from "./components/SelfUpdate";
import { createThemeContext } from "./context/theme";
import { createBlacklistContext } from "./context/blacklist";
import { DropInstaller } from "./components/DropInstaller";
import { WindowTitlebar } from "./components/WindowTitlebar";
import { CrashAssistant } from "./components/CrashAssistant";
import { Settings } from "./routes/Settings";
import { Loenn } from "./routes/Loenn";
import { KeyBindings } from "./routes/KeyBindings";
import { featureVisible, useUpdateInfo } from "./api/updateInfo";
import { getCurrentWebview } from "@tauri-apps/api/webview";

const pages = {
  Search: memo(Search),
  Home: memo(Home),
  Everest: memo(Everest),
  Manage: memo(Manage),
  Multiplayer: memo(Multiplayer),
  RecommendMods: memo(RecommendMods),
  Loenn: memo(Loenn),
  Settings: memo(Settings),
  KeyBindings: memo(KeyBindings),
};

type Services = {
  bus: EventTarget;
  modManage: ReturnType<typeof createModManageContext>;
  everest: ReturnType<typeof createEverestContext>;
  pageController: { setPage(name: string): void };
  theme: ReturnType<typeof createThemeContext>;
  blacklist: ReturnType<typeof createBlacklistContext>;
};

let currentServices: Services | undefined;
export const useGlobalContext = () => {
  if (!currentServices)
    throw new Error("Application services are not initialized");
  return currentServices;
};

export default function App() {
  useInitializeAppStore();
  createI18NContext();

  const page = useAppStore((state) => state.page);
  const setPage = useAppStore((state) => state.setPage);
  const downloadMenuOpen = useAppStore((state) => state.downloadMenuOpen);
  const setDownloadMenuOpen = useAppStore((state) => state.setDownloadMenuOpen);
  const fontScale = useAppStore((state) => state.fontScale);
  const manageFontScale = useAppStore((state) => state.manageFontScale);
  const keyBindingsFontScale = useAppStore(
    (state) => state.keyBindingsFontScale,
  );
  const enablePageTransitions = useAppStore(
    (state) => state.enablePageTransitions,
  );
  const [gamePath] = useGamePath();
  const { currentLang } = useCurrentLang();
  const { data: updateInfo } = useUpdateInfo();
  const showLoenn = featureVisible(updateInfo?.loenn, currentLang);

  const modManage = createModManageContext();
  const everest = createEverestContext();
  const blacklist = createBlacklistContext();
  const theme = createThemeContext();
  const bus = useMemo(() => new EventTarget(), []);
  const [visiblePage, setVisiblePage] = useState(page);
  const [leavingPage, setLeavingPage] = useState<string | null>(null);
  const visiblePageRef = useRef(page);
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const [sidebarFade, setSidebarFade] = useState({ top: false, bottom: false });

  const updateSidebarFade = useCallback(() => {
    const element = sidebarScrollRef.current;
    if (!element) return;
    const top = element.scrollTop > 1;
    const bottom =
      element.scrollTop + element.clientHeight < element.scrollHeight - 1;
    setSidebarFade((current) =>
      current.top === top && current.bottom === bottom
        ? current
        : { top, bottom },
    );
  }, []);

  currentServices = {
    bus,
    modManage,
    everest,
    blacklist,
    theme,
    pageController: { setPage },
  };

  useEffect(() => {
    void checkUpdate().catch(console.error);
  }, []);

  useEffect(() => {
    const scale = fontScale / 100;
    if ("__TAURI_INTERNALS__" in window) {
      void getCurrentWebview()
        .setZoom(scale)
        .catch((error) => {
          console.error("Failed to apply interface scale", error);
        });
      return;
    }
    document.documentElement.style.zoom = String(scale);
  }, [fontScale]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--manage-font-scale",
      String(manageFontScale / 100),
    );
    document.documentElement.style.setProperty(
      "--keybindings-font-scale",
      String(keyBindingsFontScale / 100),
    );
  }, [keyBindingsFontScale, manageFontScale]);

  useEffect(() => {
    const element = sidebarScrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(updateSidebarFade);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    updateSidebarFade();
    return () => observer.disconnect();
  }, [currentLang, gamePath, showLoenn, updateSidebarFade]);

  useEffect(() => {
    if (page === "RecommendMaps") setPage("RecommendMods");
  }, [page, setPage]);

  useEffect(() => {
    if (page === "Loenn" && updateInfo && !showLoenn) setPage("Home");
  }, [page, setPage, showLoenn, updateInfo]);

  useEffect(() => {
    const previousPage = visiblePageRef.current;

    if (!enablePageTransitions) {
      visiblePageRef.current = page;
      setVisiblePage(page);
      setLeavingPage(null);
      return;
    }

    if (previousPage === page) return;

    visiblePageRef.current = page;
    setLeavingPage(previousPage);
    setVisiblePage(page);

    const timer = window.setTimeout(() => setLeavingPage(null), 240);
    return () => window.clearTimeout(timer);
  }, [enablePageTransitions, page]);

  const SidebarButton = ({
    icon,
    name,
    title,
  }: {
    icon: string;
    name: string;
    title: string;
  }) => (
    <button
      className={`navBtn ${name === page ? "selected" : ""}`}
      onClick={() => setPage(name)}
    >
      <Icon name={icon} />
      <span className="title">{title}</span>
    </button>
  );

  return (
    <div className="app-frame">
      <WindowTitlebar />
      <div className="app-shell">
        <DownloadListMenu
          open={downloadMenuOpen}
          onClose={() => setDownloadMenuOpen(false)}
        />
        <DropInstaller />
        <CrashAssistant />
        <nav className="sidebar">
          <div
            ref={sidebarScrollRef}
            className={`sidebar-scroll ${sidebarFade.top ? "fade-top" : ""} ${
              sidebarFade.bottom ? "fade-bottom" : ""
            }`}
            onScroll={updateSidebarFade}
          >
            <div className="sidebar-items">
              <SidebarButton icon="home" name="Home" title={_i18n.t("主页")} />
              {gamePath && (
                <Fragment>
                  <SidebarButton
                    icon="chart-area"
                    name="Everest"
                    title="Everest"
                  />
                  <SidebarButton
                    icon="search"
                    name="Search"
                    title={_i18n.t("搜索")}
                  />
                  <SidebarButton
                    icon="drive"
                    name="Manage"
                    title={_i18n.t("管理")}
                  />
                  <SidebarButton
                    icon="keyboard"
                    name="KeyBindings"
                    title={_i18n.t("按键")}
                  />
                  {currentLang === "zh-CN" && (
                    <SidebarButton
                      icon="web"
                      name="Multiplayer"
                      title={_i18n.t("联机相关")}
                    />
                  )}
                  <SidebarButton
                    icon="flag"
                    name="RecommendMods"
                    title={_i18n.t("推荐模组")}
                  />
                </Fragment>
              )}
              {showLoenn && (
                <SidebarButton icon="edit" name="Loenn" title="Loenn" />
              )}
              <SidebarButton
                icon="settings"
                name="Settings"
                title={_i18n.t("设置")}
              />
            </div>
          </div>
          <button
            className="downloadListBtn"
            onClick={() => setDownloadMenuOpen(!downloadMenuOpen)}
          >
            <Icon name="download" />
          </button>
        </nav>
        <main className="app-content">
          {Object.entries(pages).map(([name, Page]) => (
            <section
              className={`page page-${name}${
                enablePageTransitions && name === visiblePage
                  ? " page-entering"
                  : ""
              }${
                enablePageTransitions && name === leavingPage
                  ? " page-leaving"
                  : ""
              }`}
              key={name}
              hidden={name !== visiblePage && name !== leavingPage}
              aria-hidden={name !== visiblePage}
            >
              {(name === visiblePage || name === leavingPage) && <Page />}
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
