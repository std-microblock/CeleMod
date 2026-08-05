import { Fragment, memo, useEffect, useMemo } from 'react';
import _i18n, { createI18NContext } from './i18n';
import { Icon } from './components/Icon';
import { Search } from './routes/Search';
import { Home } from './routes/Home';
import { Manage } from './routes/Manage';
import { Multiplayer } from './routes/Multiplayer';
import { EventTarget } from './utils';
import { RecommendMods } from './routes/RecommendMods';
import { useAppStore, useCurrentLang, useGamePath, useInitializeAppStore } from './states';
import { createModManageContext } from './context/modManage';
import { createDownloadContext } from './context/download';
import { DownloadListMenu } from './components/DownloadList';
import { useEverestCtx as createEverestContext } from './context/everest';
import { Everest } from './routes/Everest';
import { checkUpdate } from './components/SelfUpdate';
import { createThemeContext } from './context/theme';
import { createBlacklistContext } from './context/blacklist';
import { RecommendMaps } from './routes/RecommendMaps';
import { DropInstaller } from './components/DropInstaller';
import { WindowTitlebar } from './components/WindowTitlebar';

const pages = {
  Search: memo(Search), Home: memo(Home), Everest: memo(Everest), Manage: memo(Manage),
  Multiplayer: memo(Multiplayer), RecommendMods: memo(RecommendMods), RecommendMaps: memo(RecommendMaps),
};

type Services = {
  bus: EventTarget;
  modManage: ReturnType<typeof createModManageContext>;
  download: ReturnType<typeof createDownloadContext>;
  everest: ReturnType<typeof createEverestContext>;
  pageController: { setPage(name: string): void };
  theme: ReturnType<typeof createThemeContext>;
  blacklist: ReturnType<typeof createBlacklistContext>;
};

let currentServices: Services | undefined;
export const useGlobalContext = () => {
  if (!currentServices) throw new Error('Application services are not initialized');
  return currentServices;
};

export default function App() {
  useInitializeAppStore();
  createI18NContext();

  const page = useAppStore((state) => state.page);
  const setPage = useAppStore((state) => state.setPage);
  const downloadMenuOpen = useAppStore((state) => state.downloadMenuOpen);
  const setDownloadMenuOpen = useAppStore((state) => state.setDownloadMenuOpen);
  const [gamePath] = useGamePath();
  const { currentLang } = useCurrentLang();

  const modManage = createModManageContext();
  const download = createDownloadContext();
  const everest = createEverestContext();
  const blacklist = createBlacklistContext();
  const theme = createThemeContext();
  const bus = useMemo(() => new EventTarget(), []);

  currentServices = {
    bus, modManage, download, everest, blacklist, theme,
    pageController: { setPage },
  };

  useEffect(() => {
    void checkUpdate().catch(console.error);
  }, []);

  const SidebarButton = ({ icon, name, title }: { icon: string; name: string; title: string }) => (
    <button className={`navBtn ${name === page ? 'selected' : ''}`} onClick={() => setPage(name)}>
      <Icon name={icon} />
      <span className="title">{title}</span>
    </button>
  );

  return (
    <div className="app-frame">
    <WindowTitlebar />
    <div className="app-shell">
      <DownloadListMenu open={downloadMenuOpen} onClose={() => setDownloadMenuOpen(false)} />
      <DropInstaller />
      <nav className="sidebar">
        <SidebarButton icon="home" name="Home" title={_i18n.t('主页')} />
        {gamePath && (
          <Fragment>
            <SidebarButton icon="chart-area" name="Everest" title="Everest" />
            <SidebarButton icon="search" name="Search" title={_i18n.t('搜索')} />
            <SidebarButton icon="drive" name="Manage" title={_i18n.t('管理')} />
            {currentLang === 'zh-CN' && (
              <SidebarButton icon="web" name="Multiplayer" title={_i18n.t('联机相关')} />
            )}
            <SidebarButton icon="flag" name="RecommendMods" title={_i18n.t('推荐模组')} />
            <SidebarButton icon="image" name="RecommendMaps" title={_i18n.t('推荐地图')} />
          </Fragment>
        )}
        <button className="downloadListBtn" onClick={() => setDownloadMenuOpen(!downloadMenuOpen)}>
          <Icon name="download" />
        </button>
      </nav>
      <main className="app-content">
        {Object.entries(pages).map(([name, Page]) => (
          <section className="page" key={name} hidden={name !== page}>
            {name === page && <Page />}
          </section>
        ))}
      </main>
    </div>
    </div>
  );
}
