import _i18n from 'src/i18n';
import { useI18N } from 'src/i18n';
import { useContext, useState } from 'react';
import { GameSelector } from '../components/GameSelector';
import { Icon } from '../components/Icon';
import { callRemote, selectGamePath, useBlockingMask } from '../utils';
// @ts-ignore
import strawberry from '../resources/Celemod.png';
import {
  useAlwaysOnMods,
  useCurrentBlacklistProfile,
  useGamePath,
  useInstalledMods,
  useAppStore,
} from '../states';
import { ModBlacklistProfile } from '../ipc/blacklist';
import { useEffect } from 'react';
import { Button } from '../components/Button';
import './Home.scss';
import { createPopup, PopupContext } from '../components/Popup';
import { useGlobalContext } from 'src/App';

export const Home = () => {
  useI18N();
  const [gamePath, setGamePath] = useGamePath();
  const [gamePaths, setGamePaths] = useState<string[]>([]);
  useEffect(() => {
    void callRemote<string>('get_celeste_dirs')
      .then((paths) => setGamePaths(paths.split('\n').filter(Boolean)))
      .catch(console.error);
  }, [gamePath]);
  const globalCtx = useGlobalContext();

  const lastUseMap = useAppStore((state) => state.lastUseMap);
  const setLastUseMap = useAppStore((state) => state.setLastUseMap);

  const {
    profiles,
    setProfiles,
    currentProfileName,
    setCurrentProfileName,
    currentProfile,
    setCurrentProfile,
  } = useCurrentBlacklistProfile();

  const mask = useBlockingMask();

  useEffect(() => {
    if (!gamePath) return;
    void callRemote<string>('get_current_profile', gamePath).then(setCurrentProfileName).catch(console.error);
    callRemote('get_blacklist_profiles', gamePath, (data: string) => {
      setProfiles(JSON.parse(data));
    });
  }, [gamePath]);

  useEffect(() => {
    setCurrentProfile(
      profiles.find((v) => v.name === currentProfileName) || null
    );
  }, [currentProfileName, profiles]);

  const [alwaysOnMods] = useAlwaysOnMods();

  useEffect(() => {
    if (!currentProfile || !gamePath) return;
    const checkSync = async () => {
      const content = await callRemote<string>('get_current_blacklist_content', gamePath);
      const disabledFiles: string[] = content.split('\n').map(v => v.trim()).filter(v => v && !v.startsWith('#')).sort();
      const expectedDisabledFiles: string[] = currentProfile.mods
        .filter(m => !alwaysOnMods.includes(m.name))
        .map(m => m.file)
        .sort();
      const onlyInProfile = [...new Set<string>(
        expectedDisabledFiles.filter(file => !disabledFiles.includes(file))
      )];
      const onlyInFile = [...new Set<string>(
        disabledFiles.filter(file => !expectedDisabledFiles.includes(file))
      )];
      if (onlyInProfile.length > 0 || onlyInFile.length > 0) {
        createPopup(() => {
          const { hide } = useContext(PopupContext);
          const [error, setError] = useState('');

          const refreshProfiles = (selectedProfileName?: string) => {
            callRemote('get_blacklist_profiles', gamePath, (data: string) => {
              setProfiles(JSON.parse(data));
              if (selectedProfileName) {
                setCurrentProfileName(selectedProfileName);
              }
            });
          };

          return (
            <div className="popup-content blacklist-sync-popup">
              <div className="title">{_i18n.t('同步黑名单 Mod 列表')}</div>
              <div className="content">
                {_i18n.t('blacklist.txt 与当前 CeleMod Profile 不一致。请选择要保留的版本。')}
              </div>
              <div className="blacklist-diff-list">
                {onlyInProfile.length > 0 && (
                  <section>
                    <div className="diff-title">
                      <span>{_i18n.t('仅 CeleMod Profile 中禁用')}</span>
                      <span className="diff-count">{onlyInProfile.length}</span>
                    </div>
                    {onlyInProfile.map(file => (
                      <div className="diff-item profile-only" key={`profile-${file}`} title={file}>
                        <span className="diff-source">C</span>
                        <span className="diff-file">{file}</span>
                      </div>
                    ))}
                  </section>
                )}
                {onlyInFile.length > 0 && (
                  <section>
                    <div className="diff-title">
                      <span>{_i18n.t('仅 blacklist.txt 中禁用')}</span>
                      <span className="diff-count">{onlyInFile.length}</span>
                    </div>
                    {onlyInFile.map(file => (
                      <div className="diff-item file-only" key={`file-${file}`} title={file}>
                        <span className="diff-source">F</span>
                        <span className="diff-file">{file}</span>
                      </div>
                    ))}
                  </section>
                )}
              </div>
              <div className="blacklist-sync-note">
                {_i18n.t('注意，该功能不支持通配符等')}
              </div>
              {error && <div className="blacklist-sync-error">{error}</div>}
              <div className="buttons">
                <button onClick={() => {
                  globalCtx.blacklist.switchProfile(currentProfileName);
                  hide();
                }}>{_i18n.t('使用 CeleMod Profile')}</button>
                <button onClick={async () => {
                  const importedProfileName = await callRemote<string>(
                    'import_blacklist_file_as_profile',
                    gamePath,
                    JSON.stringify(alwaysOnMods)
                  );
                  if (importedProfileName.startsWith('Failed')) {
                    setError(importedProfileName);
                    return;
                  }
                  refreshProfiles(importedProfileName);
                  hide();
                }}>{_i18n.t('将文件保存为新 Profile')}</button>
                <button onClick={() => hide()}>{_i18n.t('忽略')}</button>
              </div>
            </div>
          );
        });
      }
    };
    void checkSync().catch(console.error);
  }, [currentProfile, gamePath, alwaysOnMods, currentProfileName]);

  const formatTime = (time: number) => {
    if (time === 0) return _i18n.t('未知');
    const now = Date.now();
    const diff = now - time;
    if (diff < 1000 * 60) return _i18n.t('刚刚');
    if (diff < 1000 * 60 * 60)
      return _i18n.t('{slot0}分钟前', { slot0: Math.floor(diff / 1000 / 60) });
    if (diff < 1000 * 60 * 60 * 24)
      return _i18n.t('{slot0}小时前', {
        slot0: Math.floor(diff / 1000 / 60 / 60),
      });
    if (diff < 1000 * 60 * 60 * 24 * 30)
      return _i18n.t('{slot0}天前', {
        slot0: Math.floor(diff / 1000 / 60 / 60 / 24),
      });
    if (diff < 1000 * 60 * 60 * 24 * 30 * 12)
      return _i18n.t('{slot0}月前', {
        slot0: Math.floor(diff / 1000 / 60 / 60 / 24 / 30),
      });
    return _i18n.t('很久以前');
  };

  const { installedMods } = useInstalledMods();

  return (
    <div className="home">
      <div className="info">
        <span className="part">
          <img src={strawberry} alt="" srcSet="" />
        </span>
        <span className="part">
          <div className="title">CeleMod</div>
          <div className="subtitle">An alternative mod manager for Celeste</div>
        </span>
      </div>
      <br />

      {gamePath ? (
        <div className="config">
          <GameSelector
            paths={gamePaths}
            onSelect={(e: InputEvent) => {
              // @ts-ignore
              const value = e.target.value;
              if (value === '__other__') {
                // @ts-ignore
                e.target.value = gamePath;
                selectGamePath(setGamePath);
              } else setGamePath(value);
            }}
            launchGame={(v) => {
              setLastUseMap({ ...lastUseMap, [currentProfileName]: Date.now() });
              mask.setMaskEnabled(true);
              mask.setMaskText(_i18n.t('正在启动'));
              callRemote(
                'start_game_directly',
                gamePath || gamePaths[0],
                v === 'origin'
              );
              setTimeout(() => {
                mask.setMaskEnabled(false);
              }, 20000);
            }}
          />
        </div>
      ) : (
        <div className="config">
          {_i18n.t(
            '未找到游戏！请先安装 Steam 商店或 Epic 商店版的 Celeste，或'
          )}
          <span
            onClick={() => {
              selectGamePath(setGamePath);
            }}
            style={{
              color: '#a77fdb',
            }}
          >
            {_i18n.t('点此手动选择')}
          </span>
        </div>
      )}

      <div className="config">
        <Icon name="file" />
        &nbsp;
        <span>{_i18n.t('Profile 选择')}</span>
      </div>

      <div className="config-block profiles">
        {profiles.map((v) => (
          <div
            key={v.name}
            className={`profile ${v.name === currentProfileName && 'selected'}`}
            onClick={() => {
              globalCtx.blacklist.switchProfile(v.name);
            }}
          >
            <div className="name">{v.name}</div>
            <div className="info">
              <span className="tips">{_i18n.t('上次启动')}</span>
              <span className="inf">{formatTime(lastUseMap[v.name] || 0)}</span>
            </div>

            <div className="info">
              <span className="tips">{_i18n.t('启用的 Mod 数')}</span>
              <span className="inf">
                {installedMods.length - v.mods.length}
              </span>
            </div>

            <Button
              onClick={
                // @ts-ignore
                (e) => {
                  e.stopPropagation();
                  globalCtx.blacklist.switchProfile(v.name);
                  setLastUseMap({ ...lastUseMap, [v.name]: Date.now() });
                  mask.setMaskEnabled(true);
                  mask.setMaskText(_i18n.t('正在启动'));
                  setTimeout(() => {
                    callRemote(
                      'start_game_directly',
                      gamePath || gamePaths[0],
                      false
                    );
                  }, 300);

                  setTimeout(() => {
                    mask.setMaskEnabled(false);
                  }, 20000);
                }
              }
            >
              {_i18n.t('启动')}
            </Button>
          </div>
        ))}
      </div>

    </div>
  );
};
