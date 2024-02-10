import { Fragment, FunctionComponent, createContext, h } from "preact";
import { useMemo, useState, useEffect, useContext } from "preact/hooks";
import { Icon } from "./components/Icon";

import { Search } from './routes/Search';
import { Home } from './routes/Home';
import { memo } from "preact/compat";
import { Manage } from "./routes/Manage";
import { Multiplayer } from "./routes/Multiplayer";
import { EventTarget, callRemote } from "./utils";
import { RecommendMods } from "./routes/RecommendMods";
import { useGamePath, useInstalledMods } from "./states";
import { useModManageContext } from "./context/modManage";
import { useDownloadContext } from "./context/download";
import { DownloadListMenu } from "./components/DownloadList";
import { useEverestCtx } from "./context/everest";
import { Everest } from "./routes/Everest";
import { checkUpdate } from "./components/SelfUpdate";

export const GlobalContext = createContext<{
    bus: EventTarget,
    modManage: ReturnType<typeof useModManageContext>,
    download: ReturnType<typeof useDownloadContext>,
    everest: ReturnType<typeof useEverestCtx>,
    pageController: {
        setPage(name: string): void
    }
}>({} as any);

export const useGlobalContext = () => {
    return useContext(GlobalContext);
}

export default () => {
    const pages: {
        [key: string]: FunctionComponent
    } = {
        Search, Home, Everest, Manage, Multiplayer, RecommendMods
    }

    const [page, setPage] = useState("Home");

    const [pageElement, setPageElement] = useState<{
        [key: string]: Element
    }>({});

    const createPageElement = (pageName: string) => {
        if (pageElement[pageName])
            return;

        const ele = h(memo(pages[pageName]), {});
        setPageElement({
            ...pageElement,
            [pageName]: ele
        } as any);
    }

    useEffect(() => {
        createPageElement(page);
    }, [page]);

    // setup ctx states
    const modManage = useModManageContext();
    const bus = useMemo(() => new EventTarget(), []);

    const download = useDownloadContext();
    const everest = useEverestCtx();
    const pageController = {
        setPage(name: string) {
            setPage(name);
        }
    }

    const { gamePath } = useGamePath()

    useEffect(() => {
        checkUpdate().catch(console.error);
    }, [])

    const SidebarButton = ({ onClick, icon, name, title }: any) => {
        return (<span class={`navBtn ${name === page && "selected"}`} style={{
        }} onClick={() => {
            setPage(name);
        }}>
            <Icon name={icon} />
            <span class="title">{title || name}</span>
        </span>)
    }

    return (
        <Fragment>
            {/* @ts-ignore */}
            <GlobalContext.Provider value={{
                bus,
                modManage,
                download,
                everest,
                pageController
            }}>
                <DownloadListMenu />
                <nav className="sidebar">
                    <SidebarButton icon="home" name="Home" title="主页" />
                    {
                        gamePath && (<Fragment>
                            <SidebarButton icon="chart-area" name="Everest" title="Everest" />
                            <SidebarButton icon="search" name="Search" title="搜索" />
                            <SidebarButton icon="drive" name="Manage" title="管理" />
                            <SidebarButton icon="web" name="Multiplayer" title="联机相关" />
                            <SidebarButton icon="flag" name="RecommendMods" title="推荐模组" />
                        </Fragment>)
                    }

                    <div className="downloadListBtn" onClick={() => {
                        const btn = document.querySelector('.downloadListBtn');
                        const list = document.querySelector('.downloadList');

                        // @ts-ignore
                        btn.popup(list)
                    }} >
                        <Icon name="download" />
                    </div>
                </nav>
                {Object.entries(pageElement).map(([key, value]) => {
                    return <div className="page" style={{
                        display: key === page ? "block" : "none",
                        width: "85vw",
                    }}>
                        {value}
                    </div>
                })}
            </GlobalContext.Provider>
        </Fragment>
    );
}