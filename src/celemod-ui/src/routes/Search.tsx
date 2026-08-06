import _i18n from 'src/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModList } from '../components/ModList';
import { currentMirror, initSearchSort, useAppStore, useGamePath, useSearchSort } from '../states';
import './Search.scss';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Content, searchSubmission } from '../api/wegfan';
import {
  CatalogMod,
  LocalCatalogFilters,
  getLocalCatalogOptions,
  loadModCatalog,
  queryLocalCatalog,
} from '../api/modCatalog';
import { enforceEverest } from '../components/EnforceEverestPage';

const categoryIdMap: Record<string, number> = {
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

const defaultLocalFilters: LocalCatalogFilters = {
  search: '',
  category: '',
  subCategory: '',
  section: '',
  submitter: '',
  updatedAfter: '',
  updatedBefore: '',
  minDownloads: null,
  maxDownloads: null,
  minSizeMb: null,
  maxSizeMb: null,
  sort: 'updated',
  direction: 'desc',
};

const numberValue = (value: string) => value === '' ? null : Number(value);

export const Search = () => {
  const noEverest = enforceEverest();
  const [mode, setMode] = useState<'cloud' | 'local'>(() => {
    try {
      return localStorage.getItem('celemod-search-mode') === 'local' ? 'local' : 'cloud';
    } catch {
      return 'cloud';
    }
  });
  const [cloudMods, setCloudMods] = useState<Content[]>([]);
  const [catalogMods, setCatalogMods] = useState<CatalogMod[]>([]);
  const [cloudType, setCloudType] = useState('');
  const [localFilters, setLocalFilters] = useState(defaultLocalFilters);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedPath] = useGamePath();
  const cacheTtlHours = useAppStore((state) => state.modCacheTtlHours);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [localVisibleCount, setLocalVisibleCount] = useState(50);
  const requestId = useRef(0);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  initSearchSort();
  const [sort, setSort] = useSearchSort();
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem('celemod-search-mode', mode);
    } catch (error) {
      console.error(error);
    }
  }, [mode]);

  useEffect(() => {
    if (!filterOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!filterMenuRef.current?.contains(event.target as Node)) setFilterOpen(false);
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
    categoryId: categoryIdMap[cloudType],
    search,
    sort,
    size: 25,
    includeExclusiveSubmissions: currentMirror() === 'wegfan',
  }), [cloudType, search, sort]);

  useEffect(() => {
    if (mode !== 'cloud') return;
    const currentRequest = ++requestId.current;
    setCloudMods([]);
    setCurrentPage(1);
    setHasMore(true);
    setLoadFailed(false);
    setLoading(true);
    fetchModPage(1)
      .then((data) => {
        if (currentRequest !== requestId.current) return;
        setCloudMods(data.content);
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
  }, [fetchModPage, mode, refreshKey]);

  useEffect(() => {
    if (mode !== 'local') return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    setLoadFailed(false);
    loadModCatalog(cacheTtlHours, refreshKey > 0)
      .then((mods) => {
        if (currentRequest !== requestId.current) return;
        setCatalogMods(mods);
      })
      .catch((error) => {
        if (currentRequest !== requestId.current) return;
        console.error(error);
        setLoadFailed(true);
      })
      .finally(() => {
        if (currentRequest === requestId.current) setLoading(false);
      });
  }, [cacheTtlHours, mode, refreshKey]);

  useEffect(() => {
    setLocalVisibleCount(50);
  }, [search, localFilters]);

  const catalogOptions = useMemo(() => getLocalCatalogOptions(catalogMods), [catalogMods]);
  const localResults = useMemo(() => queryLocalCatalog(catalogMods, {
    ...localFilters,
    search,
  }), [catalogMods, localFilters, search]);
  const visibleMods = mode === 'local'
    ? localResults.slice(0, localVisibleCount)
    : cloudMods;
  const localHasMore = localVisibleCount < localResults.length;

  const loadMore = useCallback(async () => {
    if (loading) return;
    if (mode === 'local') {
      setLocalVisibleCount((count) => count + 50);
      return;
    }
    if (!hasMore) return;
    const nextPage = currentPage + 1;
    setLoading(true);
    setLoadFailed(false);
    try {
      const data = await fetchModPage(nextPage);
      setCloudMods((current) => {
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
  }, [currentPage, fetchModPage, hasMore, loading, mode]);

  const localFilterCount = [
    localFilters.category,
    localFilters.subCategory,
    localFilters.section,
    localFilters.submitter,
    localFilters.updatedAfter,
    localFilters.updatedBefore,
    localFilters.minDownloads,
    localFilters.maxDownloads,
    localFilters.minSizeMb,
    localFilters.maxSizeMb,
  ].filter((value) => value !== '' && value !== null).length;

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
            placeholder={mode === 'local'
              ? _i18n.t('搜索名称、作者、版本、文件说明…')
              : _i18n.t('搜索社区 Mod')}
          />
        </div>
        <Button className="search-submit" aria-label={_i18n.t('搜索')}>
          <Icon name="search" />
        </Button>
        <Button
          className="view-toggle"
          aria-label={_i18n.t(viewMode === 'grid' ? '列表模式' : '网格模式')}
          title={_i18n.t(viewMode === 'grid' ? '列表模式' : '网格模式')}
          onClick={(event) => {
            event.preventDefault();
            setViewMode((value) => value === 'grid' ? 'list' : 'grid');
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
            {(mode === 'local' ? localFilterCount : Number(Boolean(cloudType))) > 0 && (
              <span className="filter-count">
                {mode === 'local' ? localFilterCount : 1}
              </span>
            )}
          </Button>

          {filterOpen && (
            <div className="filter-popup" role="dialog" aria-label={_i18n.t('筛选')}>
              <div className="filter-popup-header">
                <div>
                  <strong>{_i18n.t('搜索来源')}</strong>
                  <span>{mode === 'local'
                    ? _i18n.t('使用本机缓存，筛选更完整')
                    : _i18n.t('实时请求社区搜索接口')}</span>
                </div>
                <div className="source-switch">
                  <button
                    type="button"
                    className={mode === 'local' ? 'selected' : ''}
                    onClick={() => setMode('local')}
                  >{_i18n.t('本地')}</button>
                  <button
                    type="button"
                    className={mode === 'cloud' ? 'selected' : ''}
                    onClick={() => setMode('cloud')}
                  >{_i18n.t('云端')}</button>
                </div>
              </div>

              {mode === 'cloud' ? (
                <div className="filter-grid cloud-filter-grid">
                  <label>
                    <span>{_i18n.t('类型')}</span>
                    <select value={cloudType} onChange={(event) => setCloudType(event.target.value)}>
                      <option value="">{_i18n.t('全部')}</option>
                      {Object.keys(categoryIdMap).map((category) => (
                        <option value={category} key={category}>{category}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>{_i18n.t('排序')}</span>
                    <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                      <option value="new">{_i18n.t('最近发布')}</option>
                      <option value="updateAdded">{_i18n.t('最近添加')}</option>
                      <option value="updated">{_i18n.t('最近更新')}</option>
                      <option value="views">{_i18n.t('最多浏览')}</option>
                      <option value="likes">{_i18n.t('最多点赞')}</option>
                    </select>
                  </label>
                </div>
              ) : (
                <>
                  <div className="filter-grid">
                    <label>
                      <span>{_i18n.t('类型')}</span>
                      <select
                        value={localFilters.category}
                        onChange={(event) => setLocalFilters((value) => ({ ...value, category: event.target.value }))}
                      >
                        <option value="">{_i18n.t('全部')}</option>
                        {catalogOptions.categories.map((value) => <option key={value}>{value}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>{_i18n.t('子类型')}</span>
                      <select
                        value={localFilters.subCategory}
                        onChange={(event) => setLocalFilters((value) => ({ ...value, subCategory: event.target.value }))}
                      >
                        <option value="">{_i18n.t('全部')}</option>
                        {catalogOptions.subCategories.map((value) => <option key={value}>{value}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>{_i18n.t('来源分区')}</span>
                      <select
                        value={localFilters.section}
                        onChange={(event) => setLocalFilters((value) => ({ ...value, section: event.target.value }))}
                      >
                        <option value="">{_i18n.t('全部')}</option>
                        {catalogOptions.sections.map((value) => <option key={value}>{value}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>{_i18n.t('作者')}</span>
                      <input
                        value={localFilters.submitter}
                        onChange={(event) => setLocalFilters((value) => ({ ...value, submitter: event.target.value }))}
                      />
                    </label>
                  </div>
                  <div className="filter-section-title">{_i18n.t('更新时间')}</div>
                  <div className="filter-grid">
                    <label>
                      <span>{_i18n.t('从')}</span>
                      <input
                        type="date"
                        value={localFilters.updatedAfter}
                        onChange={(event) => setLocalFilters((value) => ({ ...value, updatedAfter: event.target.value }))}
                      />
                    </label>
                    <label>
                      <span>{_i18n.t('到')}</span>
                      <input
                        type="date"
                        value={localFilters.updatedBefore}
                        onChange={(event) => setLocalFilters((value) => ({ ...value, updatedBefore: event.target.value }))}
                      />
                    </label>
                  </div>
                  <div className="filter-section-title">{_i18n.t('数值范围')}</div>
                  <div className="filter-grid range-grid">
                    <label>
                      <span>{_i18n.t('最少下载')}</span>
                      <input type="number" min="0" value={localFilters.minDownloads ?? ''}
                        onChange={(event) => setLocalFilters((value) => ({ ...value, minDownloads: numberValue(event.target.value) }))} />
                    </label>
                    <label>
                      <span>{_i18n.t('最多下载')}</span>
                      <input type="number" min="0" value={localFilters.maxDownloads ?? ''}
                        onChange={(event) => setLocalFilters((value) => ({ ...value, maxDownloads: numberValue(event.target.value) }))} />
                    </label>
                    <label>
                      <span>{_i18n.t('最小大小 (MB)')}</span>
                      <input type="number" min="0" step="0.1" value={localFilters.minSizeMb ?? ''}
                        onChange={(event) => setLocalFilters((value) => ({ ...value, minSizeMb: numberValue(event.target.value) }))} />
                    </label>
                    <label>
                      <span>{_i18n.t('最大大小 (MB)')}</span>
                      <input type="number" min="0" step="0.1" value={localFilters.maxSizeMb ?? ''}
                        onChange={(event) => setLocalFilters((value) => ({ ...value, maxSizeMb: numberValue(event.target.value) }))} />
                    </label>
                  </div>
                  <div className="filter-grid sort-grid">
                    <label>
                      <span>{_i18n.t('排序字段')}</span>
                      <select value={localFilters.sort}
                        onChange={(event) => setLocalFilters((value) => ({ ...value, sort: event.target.value as LocalCatalogFilters['sort'] }))}>
                        <option value="updated">{_i18n.t('更新时间')}</option>
                        <option value="created">{_i18n.t('发布时间')}</option>
                        <option value="updateAdded">{_i18n.t('最近添加')}</option>
                        <option value="downloads">{_i18n.t('下载次数')}</option>
                        <option value="size">{_i18n.t('文件大小')}</option>
                        <option value="name">{_i18n.t('名称')}</option>
                      </select>
                    </label>
                    <label>
                      <span>{_i18n.t('顺序')}</span>
                      <select value={localFilters.direction}
                        onChange={(event) => setLocalFilters((value) => ({ ...value, direction: event.target.value as 'asc' | 'desc' }))}>
                        <option value="desc">{_i18n.t('降序')}</option>
                        <option value="asc">{_i18n.t('升序')}</option>
                      </select>
                    </label>
                  </div>
                </>
              )}
              <div className="filter-popup-footer">
                <span>{mode === 'local'
                  ? _i18n.t('缓存中共 {count} 条 Mod 记录', { count: catalogMods.length })
                  : _i18n.t('云端筛选由社区接口提供')}</span>
                <button type="button" onClick={() => {
                  setCloudType('');
                  setLocalFilters(defaultLocalFilters);
                }}>{_i18n.t('重置筛选')}</button>
              </div>
            </div>
          )}
        </div>
      </form>

      <div className="search-source-bar">
        <span className={`source-pill ${mode}`}>
          {mode === 'local' ? _i18n.t('本地缓存') : _i18n.t('云端搜索')}
        </span>
        <span>{mode === 'local'
          ? _i18n.t('找到 {count} 个项目', { count: localResults.length })
          : _i18n.t('社区实时结果')}</span>
      </div>

      {visibleMods.length > 0 ? (
        <ModList
          loading={loading}
          mods={visibleMods}
          haveMore={mode === 'local' ? localHasMore : hasMore}
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
