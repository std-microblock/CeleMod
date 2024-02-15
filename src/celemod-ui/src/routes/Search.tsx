import _i18n from 'src/i18n';
import { Fragment, h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { ModList } from '../components/ModList';
import { getMods, Mod, SearchModResp } from '../api/xmao';
import { currentMirror, useCurrentEverestVersion, useGamePath, useMirror } from '../states';
import './Search.scss';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { useCallback, useRef } from 'react';
import { Content, searchSubmission } from '../api/wegfan';
import { useGlobalContext } from '../App';
import { enforceEverest } from '../components/EnforceEverestPage';

const categoryIdMap = {
  Assets: 15655,
  Dialog: 4633,
  Effects: 1501,
  Helpers: 5081,
  Maps: 6800,
  Mechanics: 4635,
  'Other/Misc': 4632,
  Skins: 11181,
  'Twitch Integration': 4636,
  UI: 2317,
};

export const Search = () => {
  const noEverest = enforceEverest();
  if (noEverest) return noEverest;

  const [mods, setMods] = useState<Content[]>([]);
  const [type, setType] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [selectedPath] = useGamePath();
  const [loading, setLoading] = useState(true);
  const loadingLock = useRef(false);
  const [sort, setSort] = useState<
    'new' | 'updateAdded' | 'updated' | 'views' | 'likes'
  >('likes');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const fetchModPage = async (page: number) => {
    console.log('fetching', page);
    setLoading(true);
    const res = await searchSubmission({
      page,
      // @ts-ignore
      categoryId: categoryIdMap[type],
      search,
      sort,
      // section: 'Mod',
      size: 25,
      includeExclusiveSubmissions: currentMirror() === 'wegfan'
    });
    console.log('finished, size:', res.content.length);
    setLoading(false);
    return res;
  };

  useEffect(() => {
    setMods([]);
    setCurrentPage(1);
    fetchModPage(1).then(v=>{
      setMods(v.content);
      setHasMore(v.hasNextPage);
    });
  }, [type, search, sort]);

  useEffect(() => {
    loadingLock.current = false;
  }, [mods]);

  return (
    <Fragment>
      <div className="filter">
        <input
          type="text"
          className="searchinput"
          onKeyUp={(e) => {
            if (e.keyCode === 257) {
              setSearch((e.target! as any).value);
            }
          }}
        />
        <Button
          onClick={() => {
            setSearch((document.querySelector('.searchinput') as any).value);
          }}
        >
          <Icon name="search" />
        </Button>
        <select
          value={type}
          onChange={(e) => setType((e.target! as any).value)}
        >
          <option value="">{_i18n.t('全部')}</option>
          <option value="Maps">{_i18n.t('地图')}</option>
          <option value="Assets">{_i18n.t('资源')}</option>
          <option value="Effects">{_i18n.t('特效')}</option>
          <option value="UI">UI</option>
          <option value="Dialog">{_i18n.t('对话')}</option>
          <option value="Other/Misc">{_i18n.t('其他')}</option>
          <option value="Helpers">{_i18n.t('辅助')}</option>
          <option value="Skins">{_i18n.t('皮肤')}</option>
          <option value="Mechanics">{_i18n.t('机制')}</option>
          {/* <option value="Twitch Integration">Twitch整合</option> */}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort((e.target! as any).value)}
        >
          <option value="new">{_i18n.t('最近发布')}</option>
          <option value="updateAdded">{_i18n.t('最近添加')}</option>
          <option value="updated">{_i18n.t('最近更新')}</option>
          <option value="views">{_i18n.t('最多浏览')}</option>
          <option value="likes">{_i18n.t('最多点赞')}</option>
        </select>
      </div>

      {mods.length > 0 ? (
        mods[0] ? (
          <ModList
            allowUpScroll={currentPage > 1}
            loading={loading}
            mods={mods}
            haveMore={hasMore}
            onLoadMore={useCallback(
              (
                type: string,
                visibleRange: {
                  start: number;
                  end: number;
                  colWidth: number;
                }
              ) =>
                new Promise((rs) => {
                  console.log('load more', type);
                  const forceScroll = async (top: number) => {
                    const list = document.querySelector('.mod-list')!;
                    while (list.scrollTop !== top) {
                      list.scrollTo({
                        top: top,
                        behavior: 'instant',
                      });
                      await new Promise((rs) => setTimeout(rs, 10));
                    }
                  };

                  const fadeIn = () => {
                    const list = document.querySelector('.mod-list')!;
                    // @ts-ignore
                    list.style.opacity = '1';
                  };

                  const fadeOut = () => {
                    const list = document.querySelector('.mod-list')!;
                    // @ts-ignore
                    list.style.opacity = '0';
                  };

                  if (type === 'up') {
                    if (currentPage === 1) return;
                    if (loadingLock.current) return;
                    loadingLock.current = true;
                    fadeOut();
                    setCurrentPage((v) => {
                      fetchModPage(v - 1).then((data) => {
                        const newMods = data.content;
                        setHasMore(data.hasNextPage);
                        if (newMods.length === 0) return;
                        setMods(newMods);
                        rs(void 0);
                        const list = document.querySelector('.mod-list')! as any;
                        const bottomPaddingUpTop =
                          list.scrollTop +
                          list.lastElementChild.offsetTop -
                          list.offsetHeight -
                          80;
                        forceScroll(bottomPaddingUpTop).then(fadeIn);
                      });
                      return v - 1;
                    });
                  } else {
                    if (loadingLock.current) return;
                    loadingLock.current = true;
                    fadeOut();
                    setCurrentPage((v) => {
                      fetchModPage(v + 1).then((data) => {
                        const newMods = data.content;
                        setHasMore(data.hasNextPage);
                        if (newMods.length === 0) return;
                        setMods(newMods);
                        rs(void 0);
                        forceScroll(40).then(fadeIn);
                      });
                      return v + 1;
                    });
                  }
                }),
              [currentPage]
            )}
            modFolder={selectedPath + '/Mods'}
          />
        ) : (
          <div className="empty">{_i18n.t('加载失败，请重试')}</div>
        )
      ) : loading ? (
        <div className="empty"></div>
      ) : (
        <div className="empty">{_i18n.t('无内容')}</div>
      )}
    </Fragment>
  );
};
