import _i18n from 'src/i18n';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import './Manage.scss';
import {
  MOD_TYPE_OPTIONS,
  useAlwaysOnMods,
  useAppStore,
  useCurrentBlacklistProfile,
  useGamePath,
  useInstalledMods,
  useModComments,
} from '../states';
import { callRemote, compareVersion } from '../utils';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { useGlobalContext } from '../App';
import { enforceEverest } from '../components/EnforceEverestPage';
import { useDownloadStore } from '../stores/download';
import { createPopup, PopupContext } from '../components/Popup';
import { ProgressIndicator } from '../components/Progress';
import {
  CatalogMod,
  loadModCatalog,
} from '../api/modCatalog';
import { Content, searchSubmission } from '../api/wegfan';
import { sanitizeDescriptionHtml } from '../sanitizeDescriptionHtml';
import {
  ManageCatalogMeta,
  ManageNode,
  alternativesCovering,
  collectSwitchNames,
  excludedDependencyNames,
  getDependencyHealth,
  selectVisibleRootNames,
  useManageStore,
} from '../stores/manage';

type LatestModInfo = {
  name: string;
  version: string;
  gbFile: string;
  current: string;
  url: string;
};

type FullModCheckProgress = {
  current: number;
  total: number;
  file: string;
  done: boolean;
  issues: { file: string; error: string }[];
};

const formatSize = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / (1024 ** index)).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
};

const Badge = ({
  children,
  tone = 'neutral',
  title,
  onClick,
  onContextMenu,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
  title?: string;
  onClick?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) => (
  <span
    className={`manage-badge tone-${tone} ${onClick ? 'clickable' : ''}`}
    title={title}
    onClick={(event) => { event.stopPropagation(); onClick?.(); }}
    onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onContextMenu?.(event); }}
  >{children}</span>
);

const catalogMaps = (mods: CatalogMod[]) => {
  const metaByName: Record<string, ManageCatalogMeta> = {};
  const fullByName = new Map<string, CatalogMod>();
  for (const mod of mods) {
    const key = mod.name.trim().toLocaleLowerCase();
    const submission = mod.submissionFile.submission;
    const current = fullByName.get(key);
    if (!current || Date.parse(mod.updateTime) > Date.parse(current.updateTime)) fullByName.set(key, mod);
    metaByName[key] = {
      category: submission.categoryName,
      subCategory: submission.subCategoryName,
      submitter: submission.submitter,
      submissionName: submission.name,
      pageUrl: submission.pageUrl,
      downloads: mod.submissionFile.downloads,
      catalogSize: mod.submissionFile.size,
      updatedAt: submission.updateTime,
      gameBananaId: submission.gameBananaId,
    };
  }
  return { metaByName, fullByName };
};

const showModDetails = (node: ManageNode, catalogMod?: CatalogMod) => {
  createPopup(() => {
    const popup = useContext(PopupContext);
    const [cloud, setCloud] = useState<Content | null>(null);
    const [cloudDone, setCloudDone] = useState(false);
    const descriptionRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const submission = catalogMod?.submissionFile.submission;
      if (!submission) {
        setCloudDone(true);
        return;
      }
      searchSubmission({ search: submission.name, size: 12 })
        .then((result) => {
          setCloud(result.content.find((item) => item.gameBananaId === submission.gameBananaId) ?? null);
        })
        .catch(console.error)
        .finally(() => setCloudDone(true));
    }, []);

    useEffect(() => {
      if (!descriptionRef.current || !cloud) return;
      descriptionRef.current.innerHTML = '';
      descriptionRef.current.appendChild(sanitizeDescriptionHtml(cloud.description || ''));
      for (const link of Array.from(descriptionRef.current.querySelectorAll('a'))) {
        const url = link.getAttribute('href');
        if (!url) continue;
        link.setAttribute('href', '#');
        link.addEventListener('click', (event) => {
          event.preventDefault();
          void callRemote('open_url', url);
        });
      }
    }, [cloud]);

    const meta = node.meta;
    return (
      <div className="manage-detail-popup">
        <button className="detail-close" onClick={popup.hide}><Icon name="i-cross" /></button>
        <div className="detail-heading">
          <div>
            <span className="detail-kicker">{meta?.category || _i18n.t('本地 Mod')}</span>
            <h2>{meta?.submissionName || node.name}</h2>
            <p>{node.name} · {node.version}</p>
          </div>
          {meta?.pageUrl && (
            <button onClick={() => callRemote('open_url', meta.pageUrl!)} title={_i18n.t('打开原页面')}>
              <Icon name="external" />
            </button>
          )}
        </div>
        <div className="detail-stats">
          <div><span>{_i18n.t('作者')}</span><strong>{meta?.submitter || '--'}</strong></div>
          <div><span>{_i18n.t('类型')}</span><strong>{meta?.subCategory || meta?.category || '--'}</strong></div>
          <div><span>{_i18n.t('下载次数')}</span><strong>{meta?.downloads?.toLocaleString() || '--'}</strong></div>
          <div><span>{_i18n.t('文件大小')}</span><strong>{formatSize(meta?.catalogSize || node.size)}</strong></div>
        </div>
        {cloud?.screenshots?.length ? (
          <div className="detail-images">
            {cloud.screenshots.map((image) => <img key={image.id} src={`${image.url}?h=180`} alt="" />)}
          </div>
        ) : null}
        {!cloudDone ? (
          <div className="detail-loading"><ProgressIndicator infinite size={28} /></div>
        ) : cloud ? (
          <div className="detail-description" ref={descriptionRef} />
        ) : (
          <div className="detail-description detail-local-only">
            {_i18n.t('本地缓存包含版本、分类、作者、下载量、大小和更新时间；云端详情暂不可用。')}
          </div>
        )}
        <div className="detail-files">
          <strong>{_i18n.t('本地文件')}</strong>
          <span>{node.file} · {formatSize(node.size)}</span>
        </div>
      </div>
    );
  }, { backgroundMask: '#111318' });
};

interface ManageActions {
  switchNodes: (names: string | string[], enabled: boolean, recursive?: boolean) => void;
  deleteNode: (name: string) => void;
  updateNode: (name: string) => Promise<boolean>;
  downloadMissing: (name: string) => void;
  showDetails: (name: string) => void;
  toggleAlwaysOn: (name: string) => void;
  updateNames: Set<string>;
  updateStates: Record<string, string>;
  alwaysOnMods: string[];
  comments: Record<string, string>;
  setComment: (name: string, comment: string) => void;
  checkOptional: boolean;
  fullTree: boolean;
  showDetailed: boolean;
}

const ManageActionsContext = createContext<ManageActions | null>(null);

const MissingDependencyRow = ({ dependency, depth }: { dependency: { name: string; version: string; optional: boolean }; depth: number }) => {
  const actions = useContext(ManageActionsContext)!;
  const [state, setState] = useState(dependency.optional ? _i18n.t('可选依赖 · 下载') : _i18n.t('缺失 · 下载'));
  return (
    <div className="manage-tree-row missing" style={{ '--tree-depth': depth } as React.CSSProperties}>
      <span className="tree-connector" />
      <span className="tree-expander leaf"><Icon name="warn" /></span>
      <div className="tree-row-main">
        <div className="tree-primary-line">
          <Badge tone={dependency.optional ? 'warning' : 'danger'} onClick={() => {
            setState(_i18n.t('下载中…'));
            actions.downloadMissing(dependency.name);
          }}>{state}</Badge>
          <strong>{dependency.name}</strong>
          <span className="tree-version">≥ {dependency.version}</span>
        </div>
      </div>
    </div>
  );
};

const ManageTreeNode = ({
  name,
  depth = 0,
  path = [],
  optional = false,
}: {
  name: string;
  depth?: number;
  path?: string[];
  optional?: boolean;
}) => {
  const actions = useContext(ManageActionsContext)!;
  const node = useManageStore((state) => state.nodes[name]);
  const nodes = useManageStore((state) => state.nodes);
  const expanded = useManageStore((state) => Boolean(state.expanded[name]));
  const setExpanded = useManageStore((state) => state.setExpanded);
  const [editingComment, setEditingComment] = useState(false);
  if (!node || excludedDependencyNames.has(name)) return null;
  const visibleDependencies = node.dependencies.filter((dependency) => (
    !excludedDependencyNames.has(dependency.name) && (actions.checkOptional || !dependency.optional)
  ));
  const hasDependencies = visibleDependencies.length > 0;
  const cycle = path.includes(name);
  const health = getDependencyHealth(name, nodes, actions.checkOptional);
  const isAlwaysOn = actions.alwaysOnMods.includes(name);
  const covered = alternativesCovering(name, nodes);
  const hasUpdate = actions.updateNames.has(name);

  return (
    <div className="manage-tree-node">
      <div className={`manage-tree-row ${node.enabled ? 'enabled' : 'disabled'}`} style={{ '--tree-depth': depth } as React.CSSProperties}>
        <span className="tree-connector" />
        <button
          className={`tree-expander ${hasDependencies ? '' : 'leaf'}`}
          onClick={() => hasDependencies && setExpanded(name, !expanded)}
          title={hasDependencies ? _i18n.t(expanded ? '收起依赖' : '展开依赖') : ''}
        >
          <Icon name={hasDependencies ? (expanded ? 'i-down' : 'i-right') : 'i-asterisk'} />
        </button>
        <div className="tree-row-main">
          <div className="tree-primary-line">
            <button
              className={`state-switch ${isAlwaysOn ? 'always' : node.enabled ? 'enabled' : ''}`}
              onClick={() => actions.switchNodes(name, !node.enabled)}
              onContextMenu={(event) => { event.preventDefault(); actions.toggleAlwaysOn(name); }}
              title={_i18n.t('点击切换；右键设为始终开启')}
            >
              <span />
              {isAlwaysOn ? _i18n.t('始终开启') : node.enabled ? _i18n.t('已启用') : _i18n.t('已禁用')}
            </button>
            {editingComment ? (
              <input
                autoFocus
                className="tree-comment-input"
                value={actions.comments[name] ?? ''}
                onChange={(event) => actions.setComment(name, event.target.value)}
                onBlur={() => setEditingComment(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === 'Escape') setEditingComment(false);
                }}
              />
            ) : (
              <button className="tree-name" onClick={() => setEditingComment(true)} title={_i18n.t('点击编辑备注')}>
                {name}
              </button>
            )}
            <span className="tree-version">{node.version}</span>
            {actions.comments[name] && !editingComment && <span className="tree-comment">{actions.comments[name]}</span>}
          </div>
          <div className="tree-secondary-line">
            {node.meta?.category && <Badge tone="neutral">{node.meta.category}</Badge>}
            {optional && <Badge tone="warning">{_i18n.t('可选依赖')}</Badge>}
            {health.status === 'missing' && <Badge tone="danger" title={health.messages.join('\n')}>{_i18n.t('依赖缺失')}</Badge>}
            {health.status === 'disabled' && <Badge tone="warning" title={health.messages.join('\n')}>{_i18n.t('依赖未启用')}</Badge>}
            {health.status === 'version' && <Badge tone="warning" title={health.messages.join('\n')}>{_i18n.t('版本不匹配')}</Badge>}
            {cycle && <Badge tone="accent">{_i18n.t('循环依赖')}</Badge>}
            {covered.length > 0 && <Badge tone="info" title={covered.join(', ')}>{_i18n.t('已被替代')}</Badge>}
            {node.dependedBy.filter((dependent) => nodes[dependent]?.enabled).length > 0 && (
              <Badge tone="info" title={node.dependedBy.join(', ')}>
                {_i18n.t('{count} 个启用项依赖', { count: node.dependedBy.filter((dependent) => nodes[dependent]?.enabled).length })}
              </Badge>
            )}
            {node.duplicateFiles.length > 1 && <Badge tone="danger" title={node.duplicateFiles.join('\n')}>{_i18n.t('重复')} × {node.duplicateFiles.length}</Badge>}
            {hasUpdate && <Badge tone="warning" onClick={() => actions.updateNode(name)}>{actions.updateStates[name] || _i18n.t('可更新')}</Badge>}
            {actions.showDetailed && <span className="tree-file-detail">{formatSize(node.size)} · {node.file}</span>}
          </div>
        </div>
        <div className="tree-row-actions">
          <button onClick={() => actions.showDetails(name)} title={_i18n.t('查看 Mod 详情')}><Icon name="opts-h" /></button>
          <button className="danger" onClick={() => actions.deleteNode(name)} title={_i18n.t('删除 Mod')}><Icon name="delete" /></button>
        </div>
      </div>
      {expanded && !cycle && (!optional || actions.fullTree) && (
        <div className="tree-children">
          {visibleDependencies.map((dependency) => (
            nodes[dependency.name] ? (
              <ManageTreeNode key={`${name}-${dependency.name}`} name={dependency.name} depth={depth + 1} path={[...path, name]} optional={dependency.optional} />
            ) : (
              <MissingDependencyRow key={`${name}-${dependency.name}`} dependency={dependency} depth={depth + 1} />
            )
          ))}
        </div>
      )}
    </div>
  );
};

const ModOptionsOrderPanel = ({
  gamePath,
  profileName,
  files,
  order,
  onChange,
}: {
  gamePath: string;
  profileName: string;
  files: string[];
  order: string[];
  onChange: (order: string[]) => void;
}) => {
  const open = useManageStore((state) => state.orderPanelOpen);
  const setOpen = useManageStore((state) => state.setOrderPanelOpen);
  const [dragging, setDragging] = useState<string | null>(null);
  const normalized = useMemo(() => [
    ...order.filter((file) => files.includes(file)),
    ...files.filter((file) => !order.includes(file)).sort((a, b) => a.localeCompare(b)),
  ], [files, order]);

  const apply = (next: string[]) => {
    onChange(next);
    void callRemote('set_mod_options_order', gamePath, profileName, JSON.stringify(next));
  };

  return (
    <div className="order-panel">
      <button className="side-panel-heading" onClick={() => setOpen(!open)}>
        <span><Icon name={open ? 'i-down' : 'i-right'} /> {_i18n.t('Mod Options 顺序')}</span>
        <small>{normalized.length}</small>
      </button>
      {open && (
        <div className="order-list">
          <p>{_i18n.t('拖拽项目调整游戏内 Mod Options 的显示顺序。')}</p>
          {normalized.map((file, index) => (
            <div
              key={file}
              className={`order-item ${dragging === file ? 'dragging' : ''}`}
              draggable
              onDragStart={(event) => {
                setDragging(file);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', file);
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                const source = event.dataTransfer.getData('text/plain') || dragging;
                if (!source || source === file) return;
                const next = [...normalized];
                const sourceIndex = next.indexOf(source);
                if (sourceIndex < 0) return;
                next.splice(sourceIndex, 1);
                next.splice(index, 0, source);
                apply(next);
                setDragging(null);
              }}
            >
              <span className="drag-handle">⠿</span>
              <span className="order-index">{index + 1}</span>
              <span className="order-name" title={file}>{file}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

let lastApplyRequest = 0;

export const Manage = () => {
  const noEverest = enforceEverest();
  const [gamePath] = useGamePath();
  const modPath = `${gamePath}/Mods`;
  const global = useGlobalContext();
  const { installedMods, setInstalledMods } = useInstalledMods();
  const {
    profiles,
    setProfiles,
    setProfilesCallback,
    currentProfileName,
    setCurrentProfileName,
    currentProfile,
    setCurrentProfile,
  } = useCurrentBlacklistProfile();
  const [alwaysOnMods, setAlwaysOnMods] = useAlwaysOnMods();
  const [comments, setComments] = useModComments();
  const downloadMod = useDownloadStore((state) => state.downloadMod);
  const [catalog, setCatalog] = useState<CatalogMod[]>([]);
  const [latestRaw, setLatestRaw] = useState<[string, string, string, string][]>([]);
  const [updateStates, setUpdateStates] = useState<Record<string, string>>({});
  const [fullCheckRunning, setFullCheckRunning] = useState(false);
  const [fixingDependencies, setFixingDependencies] = useState(false);
  const [profileNameInput, setProfileNameInput] = useState('');
  const filterWrapRef = useRef<HTMLDivElement>(null);
  const actionsWrapRef = useRef<HTMLDivElement>(null);

  const nodes = useManageStore((state) => state.nodes);
  const filters = useManageStore((state) => state.filters);
  const hydrate = useManageStore((state) => state.hydrate);
  const setNodesEnabled = useManageStore((state) => state.setNodesEnabled);
  const filterOpen = useManageStore((state) => state.filterOpen);
  const setFilterOpen = useManageStore((state) => state.setFilterOpen);
  const actionMenuOpen = useManageStore((state) => state.actionMenuOpen);
  const setActionMenuOpen = useManageStore((state) => state.setActionMenuOpen);
  const setQuery = useManageStore((state) => state.setQuery);
  const setEnabledFilter = useManageStore((state) => state.setEnabledFilter);
  const setHealthFilter = useManageStore((state) => state.setHealthFilter);
  const toggleType = useManageStore((state) => state.toggleType);
  const setUpdateOnly = useManageStore((state) => state.setUpdateOnly);
  const setShowHiddenTypes = useManageStore((state) => state.setShowHiddenTypes);
  const resetFilters = useManageStore((state) => state.resetFilters);
  const collapseAll = useManageStore((state) => state.collapseAll);
  const expandAll = useManageStore((state) => state.expandAll);

  const rootOnly = useAppStore((state) => state.excludeDependents);
  const checkOptional = useAppStore((state) => state.checkOptionalDep);
  const fullTree = useAppStore((state) => state.fullTree);
  const showUpdate = useAppStore((state) => state.showUpdate);
  const showDetailed = useAppStore((state) => state.showDetailed);
  const autoToggleDependencies = useAppStore((state) => state.autoToggleDependencies);
  const autoToggleOptionalDependencies = useAppStore((state) => state.autoToggleOptionalDependencies);
  const deleteOrphansByDefault = useAppStore((state) => state.deleteOrphansByDefault);
  const hiddenModTypes = useAppStore((state) => state.hiddenModTypes);
  const cacheTtl = useAppStore((state) => state.modCacheTtlHours);

  const { metaByName, fullByName } = useMemo(() => catalogMaps(catalog), [catalog]);

  useEffect(() => {
    if (!gamePath) return;
    void callRemote<string>('get_current_profile', gamePath).then(setCurrentProfileName).catch(console.error);
    callRemote('get_blacklist_profiles', gamePath, (data: string) => setProfiles(JSON.parse(data)));
  }, [gamePath]);

  useEffect(() => {
    setCurrentProfile(profiles.find((profile) => profile.name === currentProfileName) ?? profiles[0] ?? null);
  }, [currentProfileName, profiles]);

  useEffect(() => {
    loadModCatalog(cacheTtl).then(setCatalog).catch(console.error);
    callRemote('get_mod_latest_info', (data: string) => setLatestRaw(JSON.parse(data)));
  }, [cacheTtl]);

  useEffect(() => {
    hydrate({
      installedMods,
      disabledNames: currentProfile?.mods.map((mod) => mod.name) ?? [],
      catalogByName: metaByName,
    });
  }, [installedMods, currentProfile, metaByName]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (filterOpen && !filterWrapRef.current?.contains(event.target as Node)) setFilterOpen(false);
      if (actionMenuOpen && !actionsWrapRef.current?.contains(event.target as Node)) setActionMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [actionMenuOpen, filterOpen]);

  const updates = useMemo<LatestModInfo[]>(() => installedMods.flatMap((mod) => {
    const latest = latestRaw.find((item) => item[0] === mod.name);
    if (!latest || compareVersion(latest[1], mod.version) <= 0) return [];
    return [{ name: mod.name, version: latest[1], gbFile: latest[2], current: mod.version, url: latest[3] }];
  }), [installedMods, latestRaw]);
  const updateNames = useMemo(() => new Set(updates.map((update) => update.name)), [updates]);

  const visibleRoots = useMemo(() => selectVisibleRootNames({
    nodes,
    filters,
    rootOnly,
    includeOptional: checkOptional,
    hiddenTypes: hiddenModTypes,
    updateNames,
  }), [nodes, filters, rootOnly, checkOptional, hiddenModTypes, updateNames]);

  const missingDependencies = useMemo(() => {
    const missing = new Map<string, string>();
    for (const node of Object.values(nodes)) {
      for (const dependency of node.dependencies) {
        if (excludedDependencyNames.has(dependency.name) || (dependency.optional && !checkOptional)) continue;
        if (!nodes[dependency.name]) missing.set(dependency.name, dependency.version);
      }
    }
    return [...missing.entries()].map(([name, version]) => ({ name, version }));
  }, [nodes, checkOptional]);

  const applyProfileSoon = useCallback(() => {
    const request = Date.now();
    lastApplyRequest = request;
    window.setTimeout(() => {
      if (lastApplyRequest === request && currentProfileName) global.blacklist.switchProfile(currentProfileName);
    }, 350);
  }, [currentProfileName, global.blacklist]);

  const batchSwitch = useCallback((names: string[], enabled: boolean) => {
    if (!currentProfile || names.length === 0) return;
    const effectiveNames = enabled ? names : names.filter((name) => !alwaysOnMods.includes(name));
    const files = effectiveNames.map((name) => nodes[name]?.file).filter(Boolean) as string[];
    if (effectiveNames.length === 0) return;
    void callRemote(
      'switch_mod_blacklist_profile',
      gamePath,
      currentProfileName,
      JSON.stringify(effectiveNames),
      JSON.stringify(files),
      enabled,
    );
    let nextMods = currentProfile.mods;
    if (enabled) nextMods = nextMods.filter((item) => !effectiveNames.includes(item.name));
    else {
      const additions = effectiveNames
        .filter((name) => !nextMods.some((item) => item.name === name))
        .map((name) => ({ name, file: nodes[name].file }));
      nextMods = [...nextMods, ...additions];
    }
    setCurrentProfile({ ...currentProfile, mods: nextMods });
    setNodesEnabled(effectiveNames, enabled);
    applyProfileSoon();
  }, [alwaysOnMods, applyProfileSoon, currentProfile, currentProfileName, gamePath, nodes]);

  const switchNodes = useCallback((input: string | string[], enabled: boolean, recursive = true) => {
    const names = Array.isArray(input) ? input : [input];
    batchSwitch(collectSwitchNames({
      names,
      enabled,
      nodes,
      includeDependencies: recursive && autoToggleDependencies,
      includeOptional: autoToggleOptionalDependencies,
    }), enabled);
  }, [autoToggleDependencies, autoToggleOptionalDependencies, batchSwitch, nodes]);

  const reloadMods = useCallback(() => {
    callRemote('get_installed_mods', modPath, (data: string) => setInstalledMods(JSON.parse(data)));
  }, [modPath]);

  const downloadMissing = useCallback((name: string) => {
    callRemote('get_mod_update', name, (data: string) => {
      if (!data) return;
      const [fileId] = JSON.parse(data);
      downloadMod(name, fileId, { onFinished: reloadMods });
    });
  }, [downloadMod, reloadMods]);

  const updateNode = useCallback((name: string): Promise<boolean> => {
    const update = updates.find((item) => item.name === name);
    if (!update || updateStates[name]) return Promise.resolve(false);
    setUpdateStates((state) => ({ ...state, [name]: _i18n.t('更新中…') }));
    return new Promise((resolve) => {
      downloadMod(name, update.gbFile === '-1' ? update.url : update.gbFile, {
        force: true,
        onProgress: (_task, progress) => setUpdateStates((state) => ({ ...state, [name]: `${progress.toFixed(0)}%` })),
        onFinished: () => {
          setUpdateStates((state) => ({ ...state, [name]: _i18n.t('已更新') }));
          reloadMods();
          resolve(true);
        },
        onFailed: () => {
          setUpdateStates((state) => ({ ...state, [name]: _i18n.t('更新失败') }));
          resolve(false);
        },
      });
    });
  }, [downloadMod, reloadMods, updateStates, updates]);

  const deleteNode = useCallback((name: string) => {
    const node = nodes[name];
    if (!node) return;
    const orphaned: string[] = [];
    const visited = new Set<string>();
    const visit = (nodeName: string) => {
      if (visited.has(nodeName)) return;
      visited.add(nodeName);
      for (const dependency of nodes[nodeName]?.dependencies ?? []) {
        const dependencyNode = nodes[dependency.name];
        if (!dependencyNode) continue;
        const remaining = dependencyNode.dependedBy.filter((dependent) => dependent !== name && !orphaned.includes(dependent));
        if (remaining.length === 0 && !orphaned.includes(dependency.name)) {
          orphaned.push(dependency.name);
          visit(dependency.name);
        }
      }
    };
    visit(name);
    createPopup(() => {
      const popup = useContext(PopupContext);
      const [selected, setSelected] = useState<string[]>(deleteOrphansByDefault ? orphaned : []);
      return (
        <div className="delete-mod-popup">
          <div className="title">{_i18n.t('删除 Mod')}</div>
          <div className="delete-target"><strong>{name}</strong><span>{node.version} · {node.file}</span></div>
          {node.dependedBy.length > 0 && (
            <div className="warning-section">
              <strong>{_i18n.t('以下 Mod 依赖此项目')}</strong>
              <span>{node.dependedBy.join(', ')}</span>
            </div>
          )}
          {orphaned.length > 0 && (
            <div className="orphan-section">
              <strong>{_i18n.t('同时删除不再被依赖的 Mod')}</strong>
              <div className="orphan-list">
                {orphaned.map((orphan) => (
                  <label key={orphan}>
                    <input type="checkbox" checked={selected.includes(orphan)} onChange={(event) => setSelected(event.target.checked
                      ? [...selected, orphan]
                      : selected.filter((value) => value !== orphan))} />
                    <span>{orphan}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="buttons">
            <button onClick={popup.hide}>{_i18n.t('取消')}</button>
            <button className="delete-confirm" onClick={() => {
              callRemote('delete_mods', gamePath, JSON.stringify([name, ...selected]), () => {
                reloadMods();
                popup.hide();
              });
            }}>{_i18n.t('确认删除')}</button>
          </div>
        </div>
      );
    });
  }, [deleteOrphansByDefault, gamePath, nodes, reloadMods]);

  const startFullCheck = () => {
    if (fullCheckRunning) return;
    setFullCheckRunning(true);
    createPopup(() => {
      const popup = useContext(PopupContext);
      const [progress, setProgress] = useState<FullModCheckProgress>({ current: 0, total: 0, file: '', done: false, issues: [] });
      useEffect(() => {
        callRemote('check_all_mod_contents', modPath, (data: string) => {
          const next = JSON.parse(data);
          setProgress(next);
          if (next.done) setFullCheckRunning(false);
        });
      }, []);
      return (
        <div className="full-mod-check-popup">
          <div className="title">{_i18n.t('检查 Mod 压缩包')}</div>
          {!progress.done ? (
            <div className="check-progress"><ProgressIndicator value={progress.current} max={progress.total || 1} size={76} /><span>{progress.current}/{progress.total}</span><small>{progress.file}</small></div>
          ) : progress.issues.length === 0 ? (
            <div className="check-result success"><Icon name="i-tick" /><span>{_i18n.t('全部 Mod 压缩包均可正常读取')}</span></div>
          ) : (
            <div className="check-result"><strong>{_i18n.t('发现 {count} 个问题', { count: progress.issues.length })}</strong>
              <div className="issue-list">{progress.issues.map((issue) => <div key={issue.file}><b>{issue.file}</b><span>{issue.error}</span></div>)}</div>
            </div>
          )}
          <div className="buttons">
            {progress.done && progress.issues.length > 0 && <button onClick={() => callRemote('delete_mod_files', modPath, JSON.stringify(progress.issues.map((issue) => issue.file)), () => { reloadMods(); popup.hide(); })}>{_i18n.t('删除损坏文件')}</button>}
            <button disabled={!progress.done} onClick={popup.hide}>{progress.done ? _i18n.t('完成') : _i18n.t('检查中…')}</button>
          </div>
        </div>
      );
    }, { cancelable: false });
  };

  const actions = useMemo<ManageActions>(() => ({
    switchNodes,
    deleteNode,
    updateNode,
    downloadMissing,
    showDetails(name) {
      const node = nodes[name];
      if (node) showModDetails(node, fullByName.get(name.trim().toLocaleLowerCase()));
    },
    toggleAlwaysOn(name) {
      setAlwaysOnMods(alwaysOnMods.includes(name)
        ? alwaysOnMods.filter((value) => value !== name)
        : [...alwaysOnMods, name]);
    },
    updateNames: showUpdate ? updateNames : new Set<string>(),
    updateStates,
    alwaysOnMods,
    comments,
    setComment(name, comment) { setComments({ ...comments, [name]: comment }); },
    checkOptional,
    fullTree,
    showDetailed,
  }), [alwaysOnMods, checkOptional, comments, deleteNode, downloadMissing, fullByName, fullTree, nodes, setAlwaysOnMods, setComments, showDetailed, showUpdate, switchNodes, updateNames, updateNode, updateStates]);

  const activeFilterCount = filters.types.length
    + Number(filters.enabled !== 'all')
    + Number(filters.health !== 'all')
    + Number(filters.updateOnly)
    + Number(filters.showHiddenTypes);

  if (noEverest) return noEverest;

  return (
    <div className="manage-page">
      <ManageActionsContext.Provider value={actions}>
        <section className="manage-main">
          <header className="manage-toolbar">
            <div className="manage-title-block">
              <h1>{_i18n.t('Mod 管理')}</h1>
              <span>{_i18n.t('{visible} / {total} 个 Mod', { visible: visibleRoots.length, total: Object.keys(nodes).length })}</span>
            </div>
            <div className="manage-search">
              <Icon name="search" />
              <input value={filters.query} onChange={(event) => setQuery(event.target.value)} placeholder={_i18n.t('搜索名称、备注、作者或文件…')} />
              {filters.query && <button onClick={() => setQuery('')}><Icon name="i-cross" /></button>}
            </div>
            <div className="toolbar-menu-wrap" ref={filterWrapRef}>
              <Button className={`toolbar-icon-button ${filterOpen ? 'active' : ''}`} onClick={() => setFilterOpen(!filterOpen)}>
                <Icon name="filter" />
                {activeFilterCount > 0 && <span className="toolbar-count">{activeFilterCount}</span>}
              </Button>
              {filterOpen && (
                <div className="manage-filter-popup">
                  <div className="popup-heading"><strong>{_i18n.t('筛选已下载 Mod')}</strong><button onClick={resetFilters}>{_i18n.t('重置')}</button></div>
                  <label><span>{_i18n.t('启用状态')}</span><select value={filters.enabled} onChange={(event) => setEnabledFilter(event.target.value as typeof filters.enabled)}>
                    <option value="all">{_i18n.t('全部')}</option><option value="enabled">{_i18n.t('已启用')}</option><option value="disabled">{_i18n.t('已禁用')}</option>
                  </select></label>
                  <label><span>{_i18n.t('依赖状态')}</span><select value={filters.health} onChange={(event) => setHealthFilter(event.target.value as typeof filters.health)}>
                    <option value="all">{_i18n.t('全部')}</option><option value="healthy">{_i18n.t('正常')}</option><option value="issues">{_i18n.t('有问题')}</option><option value="missing">{_i18n.t('缺失依赖')}</option>
                  </select></label>
                  <div className="filter-checks">
                    <label><input type="checkbox" checked={filters.updateOnly} onChange={(event) => setUpdateOnly(event.target.checked)} />{_i18n.t('仅显示可更新')}</label>
                    <label><input type="checkbox" checked={filters.showHiddenTypes} onChange={(event) => setShowHiddenTypes(event.target.checked)} />{_i18n.t('显示设置中隐藏的类型')}</label>
                  </div>
                  <div className="filter-type-title">{_i18n.t('类型')}</div>
                  <div className="filter-type-chips">
                    {MOD_TYPE_OPTIONS.map((type) => <button key={type} className={filters.types.includes(type) ? 'selected' : ''} onClick={() => toggleType(type)}>{type}</button>)}
                  </div>
                </div>
              )}
            </div>
            <Button className="toolbar-icon-button" onClick={() => global.pageController.setPage('Settings')} title={_i18n.t('管理设置')}><Icon name="settings" /></Button>
            <div className="toolbar-menu-wrap" ref={actionsWrapRef}>
              <Button className={`toolbar-action-button ${actionMenuOpen ? 'active' : ''}`} onClick={() => setActionMenuOpen(!actionMenuOpen)}>
                {_i18n.t('操作')} <Icon name="i-down" />
              </Button>
              {actionMenuOpen && (
                <div className="manage-action-menu">
                  <button onClick={() => callRemote('open_url', modPath)}><Icon name="file" />{_i18n.t('打开 Mods 文件夹')}</button>
                  <button onClick={() => batchSwitch(Object.keys(nodes), true)}><Icon name="i-tick" />{_i18n.t('启用全部')}</button>
                  <button onClick={() => batchSwitch(Object.keys(nodes), false)}><Icon name="i-cross" />{_i18n.t('禁用全部')}</button>
                  <button onClick={() => switchNodes(Object.values(nodes).filter((node) => node.enabled).map((node) => node.name), true)}><Icon name="replay" />{_i18n.t('启用全部依赖')}</button>
                  <button onClick={expandAll}><Icon name="i-down" />{_i18n.t('展开全部')}</button>
                  <button onClick={collapseAll}><Icon name="i-right" />{_i18n.t('收起全部')}</button>
                  <button onClick={startFullCheck}><Icon name="warn" />{fullCheckRunning ? _i18n.t('检查中…') : _i18n.t('检查 Mod 压缩包')}</button>
                </div>
              )}
            </div>
          </header>

          {(updates.length > 0 || missingDependencies.length > 0) && (
            <div className="manage-notice-bar">
              {showUpdate && updates.length > 0 && (
                <button onClick={async () => {
                  for (const update of updates) await updateNode(update.name);
                }}><Icon name="download" />{_i18n.t('更新全部 ({count})', { count: updates.length })}</button>
              )}
              {missingDependencies.length > 0 && (
                <button disabled={fixingDependencies} onClick={() => {
                  setFixingDependencies(true);
                  let remaining = missingDependencies.length;
                  for (const dependency of missingDependencies) {
                    callRemote('get_mod_update', dependency.name, (data: string) => {
                      if (!data) { if (--remaining === 0) setFixingDependencies(false); return; }
                      const [fileId] = JSON.parse(data);
                      downloadMod(dependency.name, fileId, {
                        onFinished: () => { if (--remaining === 0) { setFixingDependencies(false); reloadMods(); } },
                        onFailed: () => { if (--remaining === 0) setFixingDependencies(false); },
                      });
                    });
                  }
                }}><Icon name="warn" />{fixingDependencies ? _i18n.t('补全中…') : _i18n.t('补全缺失依赖 ({count})', { count: missingDependencies.length })}</button>
              )}
            </div>
          )}

          <div className="manage-tree-scroll">
            {visibleRoots.length > 0 ? visibleRoots.map((name) => <ManageTreeNode key={name} name={name} />) : (
              <div className="manage-empty"><Icon name="search" /><strong>{_i18n.t('没有符合筛选条件的 Mod')}</strong><button onClick={resetFilters}>{_i18n.t('清除筛选')}</button></div>
            )}
          </div>
        </section>

        <aside className="manage-side">
          <div className="side-section profile-section">
            <div className="side-title"><span>{_i18n.t('Profile')}</span><small>{profiles.length}</small></div>
            <div className="profile-list">
              {profiles.map((profile) => (
                <button key={profile.name} className={profile.name === currentProfileName ? 'selected' : ''} onClick={() => global.blacklist.switchProfile(profile.name)}>
                  <span className="profile-indicator" />
                  <span className="profile-name">{profile.name}</span>
                  <small>{installedMods.length - profile.mods.length}</small>
                  {profile.name !== 'Default' && <span className="profile-delete" onClick={(event) => {
                    event.stopPropagation();
                    void callRemote('remove_mod_blacklist_profile', gamePath, profile.name);
                    setProfilesCallback((items) => items.filter((item) => item.name !== profile.name));
                    if (profile.name === currentProfileName) global.blacklist.switchProfile(profiles[0]?.name ?? 'Default');
                  }}><Icon name="delete" /></span>}
                </button>
              ))}
            </div>
            <div className="profile-create">
              <input value={profileNameInput} maxLength={30} onChange={(event) => setProfileNameInput(event.target.value)} placeholder={_i18n.t('新 Profile 名称')} />
              <button onClick={() => {
                const name = profileNameInput.trim();
                if (!name || profiles.some((profile) => profile.name === name)) return;
                void callRemote('new_mod_blacklist_profile', gamePath, name);
                setProfilesCallback((items) => [...items, { name, mods: [], mod_options_order: [] }]);
                setProfileNameInput('');
                global.blacklist.switchProfile(name);
              }}><Icon name="i-tick" /></button>
            </div>
          </div>
          {currentProfile && (
            <ModOptionsOrderPanel
              gamePath={gamePath}
              profileName={currentProfileName}
              files={installedMods.map((mod) => mod.file)}
              order={currentProfile.mod_options_order ?? []}
              onChange={(order) => {
                setCurrentProfile({ ...currentProfile, mod_options_order: order });
                setProfilesCallback((items) => items.map((profile) => profile.name === currentProfile.name
                  ? { ...profile, mod_options_order: order }
                  : profile));
              }}
            />
          )}
        </aside>
      </ManageActionsContext.Provider>
    </div>
  );
};
