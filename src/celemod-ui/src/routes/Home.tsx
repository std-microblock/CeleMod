import _i18n from 'src/i18n';
import { h } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { GameSelector } from '../components/GameSelector';
import { Icon } from '../components/Icon';
import { callRemote, useBlockingMask, useSysModule } from '../utils';
// @ts-ignore
import strawberry from '../resources/Celemod.png';
import {
  useCurrentBlacklistProfile,
  useDownloadSettings,
  useGamePath,
  useStorage,
} from '../states';
import { ModBlacklistProfile } from '../ipc/blacklist';
import { useEffect } from 'react';
import { Button } from '../components/Button';
import './Home.scss';
import { createPopup } from '../components/Popup';
import { useEnableAcrylic } from 'src/context/theme';

export const Home = () => {
  const [gamePath, setGamePath] = useGamePath((v) => [
    v.gamePath,
    v.setGamePath,
  ]);
  const gamePaths = useMemo(() => {
    const paths = callRemote('get_celeste_dirs')
      .split('\n')
      .filter((v: string | null) => v);
    if (!gamePath && paths.length > 0) {
      // setGamePath(paths[0]);
    }
    return paths;
  }, [gamePath]);
  const [useChinaMirror, setUseChinaMirror] = useDownloadSettings((v) => [
    v.useCNMirror,
    v.setUseCNMirror,
  ]);
  const [counter, setCounter] = useState(0);

  const [lastUseMap, setLastUseMap] = useState<{
    [profile: string]: number;
  }>({});
  const Storage = useSysModule('storage');

  const {
    profiles,
    setProfiles,
    currentProfileName,
    setCurrentProfileName,
    currentProfile,
    setCurrentProfile,
  } = useCurrentBlacklistProfile();

  const { storage, _setStorage, _setSaveHandler, save } = useStorage();

  useEffect(() => {
    if (Storage) {
      const storageLU = Storage.open('./cele-mod.db');

      console.log('Storage', storageLU);
      // @ts-ignore
      window.configStorage = storageLU;
      _setStorage(storageLU);
      _setSaveHandler(() => {
        storageLU.commit();
      });

      window.addEventListener('beforeunload', () => {
        storageLU.close();
      });
    }
  }, [Storage]);

  useEffect(() => {
    if (storage) {
      storage.root ??= {};
      storage.root.lastUseMap ??= {};
      setLastUseMap(storage.root.lastUseMap);
    }
  }, [storage]);

  const mask = useBlockingMask();

  useEffect(() => {
    if (!gamePath) return;
    setCurrentProfileName(callRemote('get_current_profile', gamePath));
    callRemote('get_blacklist_profiles', gamePath, (data: string) => {
      setProfiles(JSON.parse(data));
    });
  }, [gamePath]);

  useEffect(() => {
    setCurrentProfile(
      profiles.find((v) => v.name === currentProfileName) || null
    );
  }, [currentProfileName, profiles]);

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

  const manualSelect = () => {
    // @ts-ignore
    const res = Window.this.selectFile({
      mode: 'open',
      filter: 'Celeste.exe|Celeste.exe',
    });
    if (res !== null) {
      // strip file:// and Celeste.exe
      const before = 'file://'.length;
      const after = 'celeste.exe'.length;
      const path = res.slice(before, res.length - after);
      console.log('Selected', path);
      setGamePath(path);
    }
  };

  const { enableAcrylic, setEnableAcrylic } = useEnableAcrylic();

  return (
    <div class="home">
      <div className="info">
        <span className="part">
          <img src={strawberry} alt="" srcset="" />
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
              setGamePath(e.target.value);
            }}
            launchGame={(v) => {
              lastUseMap[currentProfileName] = Date.now();
              setLastUseMap(lastUseMap);
              save();
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
            '未找到游戏！请先安装 Steam 商店或Epic 商店版的 Celeste，或'
          )}
          <span
            onClick={manualSelect}
            style={{
              color: '#a77fdb',
            }}
          >
            {_i18n.t('点此手动选择')}
          </span>
        </div>
      )}

      <div className="config">
        <Icon name="download" />
        &nbsp;
        <span>{_i18n.t('下载设置')}</span>
      </div>

      <div className="config-block">
        <input
          type="checkbox"
          checked={useChinaMirror}
          disabled
          name="usecnmirror"
          onChange={(e) => {
            //@ts-ignore
            const checked = e.target.checked;
            setUseChinaMirror(checked);
          }}
        />
        <label for="usecnmirror">{_i18n.t('使用中国镜像 ( @WEGFan )')}</label>
      </div>

      <div className="config-block">
        <input type="checkbox" checked={true} disabled />
        <label>{_i18n.t('使用 16 线程下载')}</label>
      </div>

      <div className="config">
        <Icon name="file" />
        &nbsp;
        <span>{_i18n.t('Profile 选择')}</span>
      </div>

      <div className="config-block profiles">
        {profiles.map((v) => (
          <div
            class={`profile ${v.name === currentProfileName && 'selected'}`}
            onClick={() => {
              setCurrentProfileName(v.name);
            }}
          >
            <div className="name">{v.name}</div>
            <div className="info">
              <span className="tips">{_i18n.t('上次启动')}</span>
              <span className="inf">{formatTime(lastUseMap[v.name] || 0)}</span>
            </div>

            <div className="info">
              <span className="tips">{_i18n.t('禁用的 Mod 数')}</span>
              <span className="inf">{v.mods.length}</span>
            </div>

            <Button
              onClick={
                // @ts-ignore
                (e) => {
                  e.stopPropagation();
                  setCurrentProfileName(v.name);
                  lastUseMap[v.name] = Date.now();
                  save();
                  setLastUseMap(lastUseMap);
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

      <div className="config theme">
        <Icon name="edit" />
        &nbsp;
        <span>{_i18n.t('主题设置')}</span>
      </div>

      <div className="config-block">
        <label>
          <input
            type="checkbox"
            checked={enableAcrylic}
            onClick={() => {
              setEnableAcrylic(!enableAcrylic);
            }}
          />
          <span>{_i18n.t('启用亚克力效果')}</span>
        </label>
      </div>
    </div>
  );
};
