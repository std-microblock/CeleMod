import _i18n, { I18NContext, createI18NContext } from 'src/i18n';
import { Fragment, FunctionComponent, createContext, h } from 'preact';
import { useMemo, useState, useEffect, useContext } from 'preact/hooks';
import { Icon } from './components/Icon';

import { Search } from './routes/Search';
import { Home } from './routes/Home';
import { memo } from 'preact/compat';
import { Manage } from './routes/Manage';
import { Multiplayer } from './routes/Multiplayer';
import { EventTarget, callRemote } from './utils';
import { RecommendMods } from './routes/RecommendMods';
import { initMirror, useCurrentLang, useGamePath, useInstalledMods } from './states';
import { createModManageContext } from './context/modManage';
import { createDownloadContext } from './context/download';
import { DownloadListMenu } from './components/DownloadList';
import { useEverestCtx as createEverestContext } from './context/everest';
import { Everest } from './routes/Everest';
import { checkUpdate } from './components/SelfUpdate';
import { createThemeContext } from './context/theme';
import { createBlacklistContext } from './context/blacklist';
import { RecommendMaps } from './routes/RecommendMaps';

export const GlobalContext = createContext<{
  bus: EventTarget;
  modManage: ReturnType<typeof createModManageContext>;
  download: ReturnType<typeof createDownloadContext>;
  everest: ReturnType<typeof createEverestContext>;
  pageController: {
    setPage(name: string): void;
  };
  theme: ReturnType<typeof createThemeContext>;
  blacklist: ReturnType<typeof createBlacklistContext>;
}>({} as any);

export const useGlobalContext = () => {
  return useContext(GlobalContext);
};

export default () => {
  const pages: {
    [key: string]: FunctionComponent;
  } = {
    Search,
    Home,
    Everest,
    Manage,
    Multiplayer,
    RecommendMods,
    RecommendMaps
  };

  const [page, setPage] = useState('RecommendMaps');

  const [pageElement, setPageElement] = useState<{
    [key: string]: Element;
  }>({});

  const createPageElement = (pageName: string) => {
    if (pageElement[pageName]) return;

    const ele = h(memo(pages[pageName]), {});
    setPageElement({
      ...pageElement,
      [pageName]: ele,
    } as any);
  };

  useEffect(() => {
    createPageElement(page);
  }, [page]);

  // setup ctx states
  const modManage = createModManageContext();
  const bus = useMemo(() => new EventTarget(), []);

  const download = createDownloadContext();
  const everest = createEverestContext();
  const blacklist = createBlacklistContext();
  const pageController = {
    setPage(name: string) {
      setPage(name);
    },
  };
  const theme = createThemeContext();
  initMirror();

  const [gamePath] = useGamePath();

  useEffect(() => {
    checkUpdate().catch(console.error);
  }, []);

  const SidebarButton = ({ onClick, icon, name, title }: any) => {
    return (
      <span
        class={`navBtn ${name === page && 'selected'}`}
        style={{}}
        onClick={() => {
          setPage(name);
        }}
      >
        <Icon name={icon} />
        <span class="title">{title || name}</span>
      </span>
    );
  };

  const { currentLang } = useCurrentLang();
  const i18nCtx = createI18NContext();

  return (
    <Fragment>
      <I18NContext.Provider value={i18nCtx}>
        {/* @ts-ignore */}
        <GlobalContext.Provider
          value={{
            bus,
            modManage,
            download,
            everest,
            pageController,
            theme,
            blacklist
          }}
        >
          <DownloadListMenu />
          <nav className="sidebar">
            <SidebarButton icon="home" name="Home" title={_i18n.t('主页')} />
            {gamePath && (
              <Fragment>
                <SidebarButton icon="chart-area" name="Everest" title="Everest" />
                <SidebarButton
                  icon="search"
                  name="Search"
                  title={_i18n.t('搜索')}
                />
                <SidebarButton
                  icon="drive"
                  name="Manage"
                  title={_i18n.t('管理')}
                />
                {
                  currentLang === 'zh-CN' && <SidebarButton
                    icon="web"
                    name="Multiplayer"
                    title={_i18n.t('联机相关')}
                  />
                }
                <SidebarButton
                  icon="flag"
                  name="RecommendMods"
                  title={_i18n.t('推荐模组')}
                />
                <SidebarButton
                  icon="image"
                  name="RecommendMaps"
                  title={_i18n.t('推荐地图')}
                />
              </Fragment>
            )}

            <div
              className="downloadListBtn"
              onClick={() => {
                const btn = document.querySelector('.downloadListBtn');
                const list = document.querySelector('.downloadList');

                // @ts-ignore
                btn.popup(list);
              }}
            >
              <Icon name="download" />
            </div>
          </nav>
          {Object.entries(pageElement).map(([key, value]) => {
            return (
              <div
                className="page"
                style={{
                  display: key === page ? 'block' : 'none',
                  width: 'calc(100vw - 150px)',
                }}
              >
                {value}
              </div>
            );
          })}
        </GlobalContext.Provider>
      </I18NContext.Provider>
    </Fragment>
  );
};
