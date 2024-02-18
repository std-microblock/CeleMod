import _i18n from 'src/i18n';
import { createContext, h } from 'preact';
import './Manage.scss';
import {
  BackendDep,
  BackendModInfo,
  useAlwaysOnMods,
  useCurrentBlacklistProfile,
  useGamePath,
  useInstalledMods,
  useStorage,
} from '../states';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { callRemote, compareVersion } from '../utils';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { GlobalContext, useGlobalContext } from '../App';
import { enforceEverest } from '../components/EnforceEverestPage';

type DepState = 'resolved' | 'missing' | 'not-enabled' | 'mismatched-version';

interface DepResolveResult {
  status: DepState;
  message: string;
}

interface ModInfo {
  name: string;
  id: string;
  enabled: boolean;
  dependencies: ModDepInfo[];
  dependedBy: ModInfo[];
  version: string;
  _deps: BackendDep[]; // raw deps
  resolveDependencies: () => DepResolveResult;
  file: string;
  duplicateCount: number;
  duplicateFiles: string[]
}

interface MissingModDepInfo {
  name: string;
  id: string;
  optional: boolean;
  version: string;
  _missing: true;
}

type ModInfoProbablyMissing = ModInfo | MissingModDepInfo;

type ModDepInfo = ModInfoProbablyMissing & {
  optional: boolean;
};

const modListContext = createContext<{
  switchMod: (id: string, enabled: boolean, recursive?: boolean) => void;
  switchProfile: (name: string) => void;
  removeProfile: (name: string) => void;
  modFolder: string;
  gamePath: string;
  currentProfileName: string;
  reloadMods: () => void;
  fullTree: boolean;
  showUpdate: boolean;
  alwaysOnMods: string[];
  switchAlwaysOn: (name: string, enabled: boolean) => void;
  hasUpdateMods: {
    name: string;
    version: string;
    gb_file: string;
  }[];
} | null>({} as any);

const ModBadge = ({
  children,
  bg,
  color,
  onClick,
  title,
  onContextMenu,
}: {
  children: any;
  color: string;
  bg: string;
  onClick?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  title?: string;
}) => {
  return (
    <span
      className="ma-badge"
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{
        background: bg,
        color: color,
        cursor: onClick ? 'pointer' : 'default',
      }}
      title={title}
    >
      {children}
    </span>
  );
};

const ModMissing = ({ name, version, optional }: MissingModDepInfo) => {
  const { download } = useGlobalContext();
  const ctx = useContext(modListContext);
  const [state, setState] = useState(_i18n.t('缺失'));
  const [gbFileID, setGBFileID] = useState<string | null>(null);
  useEffect(() => {
    callRemote('get_mod_update', name, (data: string) => {
      if (!!data) {
        const [gbFileId, version] = JSON.parse(data);
        setGBFileID(gbFileId);
        if (optional) setState(_i18n.t('点击下载'));
        else setState(_i18n.t('缺失·点击下载'));
      }
    });
  }, [name]);

  return (
    <div className="m-mod missing">
      <Icon name="warn" />
      <ModBadge
        bg={optional ? '#3ca3f4' : '#ef4647'}
        color="white"
        onClick={
          gbFileID !== null
            ? async () => {
              setState(_i18n.t('下载中'));
              download.downloadMod(name, gbFileID, {
                onProgress: (task, progress) => {
                  setState(`${progress}% (${task.subtasks.length})`);
                },
                onFinished: () => {
                  setState(_i18n.t('下载完成'));
                  ctx?.reloadMods();
                },
                onFailed: () => {
                  setState(_i18n.t('下载失败'));
                },
              });
            }
            : undefined
        }
      >
        {state}
      </ModBadge>
      {optional && (
        <ModBadge bg="#ff9800" color="white">
          {_i18n.t('可选依赖')}
        </ModBadge>
      )}

      <span>
        {name} <span className="modVersion">{version}</span>{' '}
      </span>
    </div>
  );
};

const excludeList = ['Everest', 'Celeste', 'EverestCore'];

const ModLocal = ({
  name,
  id,
  enabled,
  dependencies,
  resolveDependencies,
  dependedBy,
  version,
  optional = false,
  file,
  duplicateCount,
  duplicateFiles
}: ModInfo & { optional?: boolean }) => {
  const { download } = useGlobalContext();
  const [expanded, setExpanded] = useState(false);

  const ctx = useContext(modListContext);

  const hasDeps = useMemo(
    () => dependencies.some((v) => !excludeList.includes(v.name)),
    [dependencies]
  );

  const dependedByFiltered = useMemo(
    () => dependedBy.filter((v) => v.enabled),
    [dependedBy]
  );

  const depState = useMemo(resolveDependencies, [
    dependencies,
    enabled,
    resolveDependencies,
  ]);

  const [updateState, setUpdateState] = useState<[string, string] | null>(null);
  const [updateString, setUpdateString] = useState('');
  useEffect(() => {
    const update = ctx?.hasUpdateMods.find((v) => v.name === name);
    if (update) {
      setUpdateState([update.gb_file, update.version]);
      setUpdateString(_i18n.t('点击更新 · {newversion}', {
        newversion: update.version,
      }));
    }
  }, [name, ctx.hasUpdateMods]);

  const isAlwaysOn = ctx?.alwaysOnMods.includes(name);

  return (
    <div className={`m-mod ${enabled && 'enabled'}`}>
      <span
        className={`expandBtn ${expanded && 'expanded'} ${hasDeps && 'clickable'
          }`}
        onClick={() => setExpanded(!expanded)}
      >
        {hasDeps && (!optional || ctx?.fullTree) ? (
          expanded ? (
            <Icon name="i-down" />
          ) : (
            <Icon name="i-right" />
          )
        ) : (
          <Icon name="i-asterisk" />
        )}
      </span>
      <ModBadge
        bg={isAlwaysOn ? '#087EBF' : enabled ? '#4caf50' : '#2c313c'}
        color="white"
        onClick={() => {
          ctx?.switchMod(name, !enabled);
        }}
        onContextMenu={(e) => {
          ctx?.switchAlwaysOn(name, !isAlwaysOn);
        }}
      >
        {isAlwaysOn
          ? _i18n.t('始终开启')
          : enabled
            ? _i18n.t('已启用')
            : _i18n.t('已禁用')}
      </ModBadge>

      {enabled &&
        (depState.status === 'missing' ? (
          <ModBadge bg="#ef4647" color="white" title={depState.message}>
            {_i18n.t('依赖·缺失')}
          </ModBadge>
        ) : depState.status === 'not-enabled' ? (
          <ModBadge bg="#ff9800" color="white" title={depState.message}>
            {_i18n.t('依赖·未启用')}
          </ModBadge>
        ) : depState.status === 'mismatched-version' ? (
          <ModBadge bg="#ff9800" color="white" title={depState.message}>
            {_i18n.t('依赖·版本不匹配')}
          </ModBadge>
        ) : null)}

      {optional && (
        <ModBadge bg="#ff9800" color="white">
          {_i18n.t('可选依赖')}
        </ModBadge>
      )}

      {dependedByFiltered.length > 0 && (
        <ModBadge
          bg="#2196f3"
          color="white"
          title={_i18n.t('启用的，依赖此 Mod 的 Mod: {slot0}', {
            slot0: dependedByFiltered.map((v) => v.name).join(', '),
          })}
        >
          {dependedByFiltered.length}
        </ModBadge>
      )}
      {duplicateCount > 1 && <ModBadge bg="#DB3D73" color="white" title={
        duplicateFiles.map((v) => v.split('/').pop()).join(' | ')
      }>
        重复 Mod · {duplicateCount} 次
      </ModBadge>}

      {ctx?.showUpdate && updateState && (
        <ModBadge
          bg="#ff9800"
          color="white"
          onClick={() => {
            download.downloadMod(
              file.slice(0, -'.zip'.length),
              updateState[0],
              {
                onProgress: (task, progress) => {
                  setUpdateString(`${progress}% (${task.subtasks.length})`);
                },
                onFinished: () => {
                  setUpdateString(_i18n.t('下载完成'));
                  ctx?.reloadMods();
                },
                onFailed: (task) => {
                  console.log(task);
                  setUpdateString(_i18n.t('下载失败'));
                },
                force: true,
              }
            );
          }}
        >
          {updateString}
        </ModBadge>
      )}

      <span>{name}</span>
      <span className="modVersion">{version}</span>
      {(!optional || ctx?.fullTree) && expanded && (
        <div className={`childTree ${expanded && 'expanded'}`}>
          {dependencies.map((v) => (
            <Mod {...v} />
          ))}
        </div>
      )}
    </div>
  );
};

const Mod = (props: ModDepInfo) => {
  if (excludeList.includes(props.name)) {
    return null;
  }
  if ('_missing' in props) {
    return <ModMissing {...props} />;
  }
  return <ModLocal {...props} />;
};

const Profile = ({ name, current }: { name: string; current: boolean }) => {
  const ctx = useContext(modListContext);

  return (
    <div
      className={`profile ${current && 'current'}`}
      onClick={() => {
        ctx?.switchProfile(name);
      }}
    >
      <span>{name}</span>
      <span className="opers">
        {name !== 'Default' && (
          <span
            className="delete"
            onClick={(e) => {
              e.stopPropagation();
              ctx?.removeProfile(name);
            }}
          >
            <Icon name="delete" />
          </span>
        )}
      </span>
    </div>
  );
};

const alphabet =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- _';

let lastApplyReq = -1;

export const Manage = () => {
  const noEverest = enforceEverest();
  if (noEverest) return noEverest;
  const [alwaysOnMods, setAlwaysOnMods] = useAlwaysOnMods();
  const [gamePath] = useGamePath();
  const modPath = gamePath + '/Mods';

  const {
    profiles,
    setProfilesCallback,
    currentProfileName,
    setCurrentProfileName,
    currentProfile,
    setCurrentProfile,
  } = useCurrentBlacklistProfile();

  const { installedMods, setInstalledMods } = useInstalledMods();

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const [excludeDependents, setExcludeDependents] = useState(true);
  const [checkOptionalDep, setCheckOptionalDep] = useState(false);
  const [fullTree, setFullTree] = useState(false);
  const [showUpdate, setShowUpdate] = useState(true);

  const installedModMap = useMemo(() => {
    const modMap = new Map<string, ModInfo>();

    for (const mod of installedMods) {
      const modInfo: ModInfo = {
        name: mod.name,
        id: mod.game_banana_id,
        enabled: currentProfile?.mods.every((v) => v.name !== mod.name) ?? true,
        version: mod.version,
        dependencies: [],
        dependedBy: [],
        file: mod.file,
        _deps: mod.deps,
        resolveDependencies: () => {
          let status = 'resolved';
          let message = '';

          const mergeSM = (
            s: {
              status: DepState;
              message: string;
            },
            name: String
          ) => {
            if (s.status === 'resolved') return;
            if (status === 'resolved') {
              status = s.status;
            }
            message += ` | ${name}(${s.status}):${s.message}`;
          };

          for (const dep of mod.deps) {
            if (
              excludeList.includes(dep.name) ||
              (dep.optional && !checkOptionalDep)
            )
              continue;

            if (!modMap.has(dep.name)) {
              mergeSM({ status: 'missing', message: '' }, dep.name);
            } else {
              const installedDep = modMap.get(dep.name)!;
              if (compareVersion(installedDep.version, dep.version) < 0) {
                mergeSM(
                  {
                    status: 'mismatched-version',
                    message: `${mod.name} requires ${installedDep.name} >= ${dep.version} but got ${installedDep.version}`,
                  },
                  dep.name
                );
              }

              if (!installedDep.enabled) {
                mergeSM(
                  {
                    status: 'not-enabled',
                    message: `${mod.name} requires ${installedDep.name} to be enabled`,
                  },
                  dep.name
                );
              }

              const depRes = installedDep.resolveDependencies();
              mergeSM(depRes, dep.name);
            }
          }

          return { status, message } as DepResolveResult;
        },
        duplicateCount: 1,
        duplicateFiles: [mod.file]
      };
      if (modMap.has(mod.name)) {
        modMap.get(mod.name)!.duplicateCount = modMap.get(mod.name)!.duplicateCount + 1;
        modMap.get(mod.name)!.duplicateFiles.push(mod.file);
      } else {
        modMap.set(mod.name, modInfo);
      }
    }

    for (const modInfo of modMap.values()) {
      for (const dep of modInfo._deps) {
        if (!modMap.has(dep.name)) {
          modInfo.dependencies.push({
            name: dep.name,
            id: dep.name,
            version: dep.version,
            _missing: true,
            optional: dep.optional,
          });
        } else {
          const depInfo = modMap.get(dep.name)!;
          modInfo.dependencies.push({
            ...depInfo,
            optional: dep.optional,
          });
          if (!dep.optional) depInfo.dependedBy.push(modInfo);
        }
      }
    }

    return modMap;
  }, [installedMods, currentProfile, profiles, checkOptionalDep]);

  const [latestModInfos, setLatestModInfos] = useState<
    [
      string,
      string,
      string,
      string // name, version, gbfileid, url
    ][]
  >([]);

  useEffect(() => {
    callRemote('get_mod_latest_info', (v) => {
      setLatestModInfos(JSON.parse(v));
    });
  }, []);

  const hasUpdateMods: {
    name: string;
    version: string;
    gb_file: string;
    current: string;
    url: string;
  }[] = useMemo(() => {
    const mods = [];
    for (const mod of installedMods) {
      const latest = latestModInfos.find((v) => v[0] === mod.name);
      if (latest && compareVersion(latest[1], mod.version) > 0) {
        mods.push({
          name: mod.name,
          version: latest[1],
          gb_file: latest[2],
          current: mod.version,
          url: latest[3],
        });
      }
    }

    console.log('hasUpdateMods', JSON.stringify(mods, null, 4))

    return mods;
  }, [latestModInfos, installedModMap]);

  const [hasUpdateBtnState, setHasUpdateBtnState] = useState(
    _i18n.t('更新全部')
  );

  const modsTreeRef = useRef(null);
  const [filter, setFilter] = useState('');

  const checkFilter = (filter: string, mod: ModInfoProbablyMissing) => {
    if (filter.includes('||'))
      return filter.split('||').some((f) => checkFilter(f, mod));

    const isSpecialFilter = (v) =>
      v.startsWith(':') || v.startsWith('!') || v.startsWith('-');
    const args = filter.split(' ');
    const name = mod.name.toLowerCase();
    const nameFilter = args
      .filter((v) => !isSpecialFilter(v))
      .join(' ')
      .toLowerCase()
      .trim();

    // console.log(name, nameFilter);
    if (!name.includes(nameFilter)) return false;

    const checkSpecialFilter = (arg: string) => {
      arg = arg.toLowerCase();

      if (arg.startsWith(':') || arg.startsWith('-')) arg = arg.slice(1);

      if (!('_missing' in mod)) {
        if (arg.startsWith('enable')) {
          return mod.enabled || alwaysOnMods.includes(mod.name);
        } else if (arg.startsWith('disable')) {
          return !checkSpecialFilter('enable');
        }

        if (arg.startsWith('hasdep') || arg.startsWith('havedep')) {
          return mod.dependencies.length > 0;
        }

        if (
          arg.startsWith('update') ||
          arg.startsWith('hasupdate') ||
          arg.startsWith('haveupdate') ||
          arg.startsWith('outdate')
        ) {
          return hasUpdateMods.some((v) => v.name === mod.name);
        }
      }

      if (arg.startsWith('!')) {
        return !checkSpecialFilter(arg.slice(1));
      }
    };
    for (const arg of args.filter(isSpecialFilter)) {
      if (!checkSpecialFilter(arg)) return false;
    }

    return true;
  };

  const installedModsTree = useMemo(() => {
    const modTree = new Map<string, ModInfoProbablyMissing>();

    for (const mod of installedModMap.values()) {
      modTree.set(mod.name, mod);
    }

    const dfsRemove = (mod: ModInfoProbablyMissing, isRoot = false) => {
      if (filter && checkFilter(filter, mod)) return;
      if (!isRoot) {
        modTree.delete(mod.name);
      }
      if ('_missing' in mod) {
        return;
      }

      for (const dep of mod.dependencies) {
        if ((dep as any)._missing || dep.optional) {
          continue;
        }

        dfsRemove(dep);
      }
    };

    if (excludeDependents)
      for (const mod of installedModMap.values()) {
        dfsRemove(mod, true);
      }

    if (filter) {
      for (const mod of modTree.values()) {
        if (!checkFilter(filter, mod)) {
          modTree.delete(mod.name);
        }
      }
    }

    return [...modTree.values()].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );
  }, [installedModMap, excludeDependents, filter]);

  useEffect(() => {
    // @ts-ignore
    modsTreeRef.current?.scrollTo(0, 0);
  }, [excludeDependents]);
  const globalCtx = useGlobalContext();
  const manageCtx = useMemo(
    () => ({
      hasUpdateMods,
      switchAlwaysOn: (name: string, enabled: boolean) => {
        if (enabled) setAlwaysOnMods([...alwaysOnMods, name]);
        else setAlwaysOnMods(alwaysOnMods.filter((v) => v !== name));
      },
      alwaysOnMods,
      batchSwitchMod: (names: string[], enabled: boolean) => {
        if (!enabled) names = names.filter((v) => !alwaysOnMods.includes(v));
        if (!currentProfile) return;
        let files = [];
        for (const mod of names) {
          const backendMod = installedMods.find((v) => v.name === mod);
          if (backendMod) {
            files.push(backendMod.file);
            if (!enabled) {
              currentProfile.mods.push({
                name: backendMod.name,
                file: backendMod.file,
              });
            }
          }
        }

        callRemote(
          'switch_mod_blacklist_profile',
          gamePath,
          currentProfileName,
          JSON.stringify(names),
          JSON.stringify(files),
          enabled
        );

        if (enabled)
          currentProfile.mods =
            currentProfile?.mods.filter((v) => !names.includes(v.name)) ?? [];

        setCurrentProfile({ ...currentProfile });
        setHasUnsavedChanges(true);

        lastApplyReq = Date.now();
        let thisReq = lastApplyReq;
        setTimeout(() => {
          if (lastApplyReq === thisReq) {
            globalCtx.blacklist.switchProfile(manageCtx.currentProfileName);
            setHasUnsavedChanges(false);
          }
        }, 600);
      },
      switchMod: (
        names: string | string[],
        enabled: boolean,
        recursive = true
      ) => {
        if (currentProfile) {
          const switchList: string[] = [];
          const excludeFromAutoEnableList = [
            'CelesteNet.Client',
            'Miao.CelesteNet.Client',
          ];

          const addToSwitchList = (name: string) => {
            const mod = installedModMap.get(name);
            if (mod) {
              mod.enabled = enabled;
              switchList.push(name);
            }

            if (recursive) {
              if (enabled) {
                const deps = mod?.dependencies;

                for (const dep of deps ?? []) {
                  if (!('_missing' in dep)) {
                    if (excludeFromAutoEnableList.includes(dep.name)) continue;
                    addToSwitchList(dep.name);
                  }
                }
              } else {
                const orphanDeps = mod?.dependencies.filter(
                  (v) =>
                    !('_missing' in v) &&
                    !v.dependedBy.some((v) => v.enabled && v.name !== name)
                );

                for (const dep of orphanDeps ?? []) {
                  addToSwitchList(dep.name);
                }
              }
            }
          };

          if (typeof names === 'string') {
            names = [names];
          }
          for (const name of names) {
            addToSwitchList(name);
          }

          manageCtx.batchSwitchMod(switchList, enabled);
        }

        setHasUnsavedChanges(true);
      },
      switchProfile: (name: string) => {
        if (hasUnsavedChanges) return;
        globalCtx.blacklist.switchProfile(name);
        setHasUnsavedChanges(false);
      },
      removeProfile: (name: string) => {
        callRemote('remove_mod_blacklist_profile', gamePath, name);
        setProfilesCallback((profiles) =>
          profiles.filter((v) => v.name !== name)
        );
        if (currentProfileName === name) {
          setCurrentProfileName(profiles[0].name);
        }
      },
      createProfile: (name: string) => {
        callRemote('new_mod_blacklist_profile', gamePath, name);
        setProfilesCallback((profiles) => profiles.concat({ name, mods: [] }));
        setCurrentProfileName(name);
      },
      gamePath,
      modFolder: modPath,
      currentProfile,
      currentProfileName,
      reloadMods() {
        callRemote('get_installed_mods', modPath, (data: string) => {
          setInstalledMods(JSON.parse(data));
        });
      },
      fullTree,
      showUpdate,
    }),
    [
      currentProfile,
      installedMods,
      gamePath,
      modPath,
      fullTree,
      showUpdate,
      alwaysOnMods,
    ]
  );

  const { download } = useGlobalContext();

  return (
    <div className="manage">
      <modListContext.Provider value={manageCtx}>
        <div className="modList">
          <div className="title">
            {_i18n.t('Mod 列表')}

            <input
              placeholder={_i18n.t('筛选 Mod')}
              className="filter-input"
              type="text"
              value={filter}
              onChange={(e) => {
                setFilter((e.target as any).value);
              }}
            />
          </div>
          <div className="opers">
            <Button
              onClick={() => {
                callRemote('open_url', gamePath + '/Mods');
              }}
            >
              {_i18n.t('打开 Mods 文件夹')}
            </Button>
            &nbsp;&nbsp;
            <Button
              onClick={() => {
                manageCtx.switchMod(
                  [...installedModsTree.values()]
                    .map((v) => v.name)
                    .filter((v) => !alwaysOnMods.includes(v)),
                  false
                );
              }}
            >
              {_i18n.t('禁用全部')}
            </Button>
            &nbsp;&nbsp;
            <Button
              onClick={() => {
                manageCtx.batchSwitchMod(
                  installedMods.map((v) => v.name),
                  true
                );
              }}
            >
              {_i18n.t('启用全部')}
            </Button>
          </div>
          <div className="options">
            <label>
              <input
                type="checkbox"
                checked={excludeDependents}
                onChange={(e) => {
                  // @ts-ignore
                  setExcludeDependents(e.target.checked);
                }}
              />

              {_i18n.t('主树隐藏依赖')}
            </label>
            <label>
              <input
                type="checkbox"
                checked={checkOptionalDep}
                onChange={(e) => {
                  // @ts-ignore
                  setCheckOptionalDep(e.target.checked);
                }}
              />

              {_i18n.t('检查可选依赖')}
            </label>
            <label>
              <input
                type="checkbox"
                checked={fullTree}
                onChange={(e) => {
                  // @ts-ignore
                  setFullTree(e.target.checked);
                }}
              />

              {_i18n.t('显示完整树')}
            </label>
            <label>
              <input
                type="checkbox"
                checked={showUpdate}
                onChange={(e) => {
                  // @ts-ignore
                  setShowUpdate(e.target.checked);
                }}
              />

              {_i18n.t('显示更新')}
            </label>
          </div>
          <div
            className="opers"
            style={{
              marginTop: '5px',
            }}
          >
            {showUpdate && hasUpdateMods.length !== 0 && (
              <button
                onClick={() => {
                  if (hasUpdateBtnState !== _i18n.t('更新全部')) return;
                  setHasUpdateBtnState(_i18n.t('更新中'));
                  const updateUnfinishedSet = new Set(
                    hasUpdateMods.map((v) => v.name)
                  );
                  for (const mod of hasUpdateMods) {
                    download.downloadMod(mod.name, mod.gb_file === '-1' ? mod.url : mod.gb_file, {
                      onProgress: (task, progress) => {
                        console.log(task, progress);
                      },
                      onFinished: () => {
                        updateUnfinishedSet.delete(mod.name);
                        if (updateUnfinishedSet.size === 0) {
                          setHasUpdateBtnState(_i18n.t('更新完成'));
                          manageCtx.reloadMods();
                        }
                      },
                      onFailed: () => {
                        console.log('failed');
                        setHasUpdateBtnState(_i18n.t('更新失败，请查看左下角'));
                      },
                      force: true,
                    });
                  }
                }}
              >
                {hasUpdateBtnState}
              </button>
            )}
          </div>
          <div className="list" ref={modsTreeRef}>
            {installedModsTree.map((v) => (
              <Mod {...(v as any)} />
            ))}

            <div className="padding"></div>
          </div>
        </div>
        <div className="profiles">
          <div className="title">{_i18n.t('Profile 列表')}</div>
          {profiles.map((v) => (
            <Profile {...v} current={v.name === currentProfileName} />
          ))}

          <div className="newProfile">
            <input
              type="text"
              placeholder={_i18n.t('Profile 名')}
              /* @ts-ignore */
              filter={alphabet}
              maxlength="30"
            />

            <Button
              onClick={() => {
                const name = document.querySelector('.newProfile input') as any;
                if (
                  name.value &&
                  !profiles.some((v) => v.name === name.value)
                ) {
                  manageCtx.createProfile(name.value);
                  name.value = '';
                }
              }}
            >
              {_i18n.t('新建')}
            </Button>
          </div>
        </div>
      </modListContext.Provider>
    </div>
  );
};
