import _i18n from 'src/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ModList } from '../components/ModList';
import { currentMirror, initSearchSort, useGamePath, useSearchSort } from '../states';
import './Search.scss';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Content, searchSubmission } from '../api/wegfan';
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

  const [mods, setMods] = useState<Content[]>([]);
  const [type, setType] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedPath] = useGamePath();
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestId = useRef(0);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  initSearchSort();
  const [sort, setSort] = useSearchSort();
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!filterOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!filterMenuRef.current?.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFilterOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [filterOpen]);

  const fetchModPage = useCallback((page: number) => searchSubmission({
      page,
      // @ts-ignore
      categoryId: categoryIdMap[type],
      search,
      sort,
      // section: 'Mod',
      size: 25,
      includeExclusiveSubmissions: currentMirror() === 'wegfan'
    }), [search, sort, type]);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    setMods([]);
    setCurrentPage(1);
    setHasMore(true);
    setLoadFailed(false);
    setLoading(true);

    fetchModPage(1)
      .then((data) => {
        if (currentRequest !== requestId.current) return;
        setMods(data.content);
        setHasMore(data.hasNextPage);
      })
      .catch((error) => {
        if (currentRequest !== requestId.current) return;
        console.error(error);
        setLoadFailed(true);
        setHasMore(false);
      })
      .finally(() => {
        if (currentRequest === requestId.current) setLoading(false);
      });
  }, [fetchModPage, refreshKey]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;

    const nextPage = currentPage + 1;
    setLoading(true);
    setLoadFailed(false);
    try {
      const data = await fetchModPage(nextPage);
      setMods((current) => {
        const existingIds = new Set(current.map((mod) => mod.id));
        return [...current, ...data.content.filter((mod) => !existingIds.has(mod.id))];
      });
      setCurrentPage(nextPage);
      setHasMore(data.hasNextPage);
    } catch (error) {
      console.error(error);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [currentPage, fetchModPage, hasMore, loading]);

  if (noEverest) return noEverest;

  return (
    <div className="search-page">
      <form
        className="filter"
        onSubmit={(event) => {
          event.preventDefault();
          setFilterOpen(false);
          setSearch(searchInput.trim());
        }}
      >
        <div className="search-field">
          <Icon name="search" />
        <input
          type="text"
          className="searchinput"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            aria-label={_i18n.t('搜索')}
        />
        </div>
        <Button
          className="search-submit"
          aria-label={_i18n.t('搜索')}
        >
          <Icon name="search" />
        </Button>
        <Button
          className="view-toggle"
          aria-label={_i18n.t(viewMode === 'grid' ? '列表模式' : '网格模式')}
          title={_i18n.t(viewMode === 'grid' ? '列表模式' : '网格模式')}
          onClick={(event) => {
            event.preventDefault();
            setViewMode((mode) => mode === 'grid' ? 'list' : 'grid');
          }}
        >
          <Icon name={viewMode === 'grid' ? 'list' : 'grid'} />
        </Button>
        <div className="filter-menu-wrap" ref={filterMenuRef}>
          <Button
            className={`filter-toggle ${filterOpen ? 'active' : ''}`}
            aria-label={_i18n.t('筛选')}
            aria-expanded={filterOpen}
            aria-haspopup="dialog"
            onClick={(event) => {
              event.preventDefault();
              setFilterOpen((open) => !open);
            }}
          >
            <Icon name="filter" />
          </Button>

          {filterOpen && (
            <div className="filter-popup" role="dialog" aria-label={_i18n.t('筛选')}>
              <label>
                <span>{_i18n.t('类型')}</span>
                <select
                  value={type}
                  onChange={(event) => setType(event.target.value)}
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
                </select>
              </label>

              <label>
                <span>{_i18n.t('排序')}</span>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as typeof sort)}
                >
                  <option value="new">{_i18n.t('最近发布')}</option>
                  <option value="updateAdded">{_i18n.t('最近添加')}</option>
                  <option value="updated">{_i18n.t('最近更新')}</option>
                  <option value="views">{_i18n.t('最多浏览')}</option>
                  <option value="likes">{_i18n.t('最多点赞')}</option>
                </select>
              </label>
            </div>
          )}
        </div>
      </form>

      {mods.length > 0 ? (
          <ModList
            loading={loading}
            mods={mods}
            haveMore={hasMore}
            onLoadMore={loadMore}
            modFolder={selectedPath + '/Mods'}
            viewMode={viewMode}
          />
      ) : loadFailed ? (
        <div className="empty search-empty-state">
          <Icon name="fail" />
          <span>{_i18n.t('加载失败，请重试')}</span>
          <Button onClick={() => setRefreshKey((value) => value + 1)}>{_i18n.t('重试')}</Button>
        </div>
      ) : loading ? (
        <div className="empty search-empty-state"></div>
      ) : (
        <div className="empty search-empty-state">
          <Icon name="search" />
          <span>{_i18n.t('无内容')}</span>
        </div>
      )}
    </div>
  );
};
