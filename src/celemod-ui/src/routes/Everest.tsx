import _i18n from 'src/i18n';
import { Fragment, createContext, h } from 'preact';
import './Everest.scss';
import {
  BackendDep,
  BackendModInfo,
  useCurrentBlacklistProfile,
  useCurrentEverestVersion,
  useGamePath,
  useInstalledMods,
  useMirror,
} from '../states';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { callRemote, displayDate } from '../utils';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { GlobalContext, useGlobalContext } from '../App';
//@ts-ignore
import everest from '../resources/everest.png';
import { ProgressIndicator } from '../components/Progress';
import { createPopup, PopupContext } from '../components/Popup';

interface Maddie480EverestVersion {
  date: string;
  mainFileSize: number;
  mainDownload: string;
  olympusMetaDownload: string;
  commit: string;
  olympusBuildDownload: string;
  branch: string;
  version: number;
  isNative: boolean;
}

const Channel = ({
  dataFull,
  branch,
  onInstall,
  title,
}: {
  dataFull: Maddie480EverestVersion[];
  branch: string;
  title: string;
  onInstall: (url: string) => void;
}) => {
  const [data, setData] = useState<Maddie480EverestVersion[] | null>(null);

  useEffect(() => {
    setData(
      dataFull.filter(
        (v: Maddie480EverestVersion) => v.branch === branch.toLowerCase()
      )
    );
  }, [dataFull]);

  const [mirror] = useMirror()

  const getDownloadUrl = (data: Maddie480EverestVersion) => {
    if (data.branch === 'stable') {
      if (mirror === 'wegfan') return `https://celeste.weg.fan/api/v2/download/everest/${data.version}`;
      return data.mainDownload;
    }
    return data.mainDownload;
  };

  return (
    <div className="channel">
      <h2>{title}</h2>
      <div className="list">
        {data === null ? (
          <div>{_i18n.t('加载中...')}</div>
        ) : data.length === 0 ? (
          <div>{_i18n.t('无数据')}</div>
        ) : (
          data.map((v, i) => (
            <div key={i} className="item">
              <div className="line1">
                <span className="version">{v.version}</span>
                <span className="date">{displayDate(v.date)}</span>
              </div>
              <div className="line2">
                <div className="commit">{v.commit.slice(0, 7)}</div>
                <Button onClick={() => onInstall(getDownloadUrl(v))}>
                  {_i18n.t('安装')}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export const Everest = () => {
  const ctx = useGlobalContext();
  const { setCurrentEverestVersion, currentEverestVersion } =
    useCurrentEverestVersion();
  const [gamePath] = useGamePath();
  const [installingUrl, setInstallingUrl] = useState<string | null>(null);
  const [installState, setInstallState] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<number | null>(null);
  const [failedReason, setFailedReason] = useState<string | null>(null);

  const installEverest = (url: string) => {
    setInstallingUrl(url);
    setInstallProgress(null);
    setFailedReason(null);
    setInstallState('Downloading Everest');
    callRemote(
      'download_and_install_everest',
      gamePath,
      url,
      (status: string, data: any) => {
        if (status === 'Failed') {
          setInstallState('Failed');
          setFailedReason(data);
        } else {
          setInstallState(status);
          if (typeof data === 'number') {
            // console.log('progress', data);
            setInstallProgress(data);
          }
        }

        if (status === 'Success') {
          ctx.everest.updateEverestVersion();
        }
      }
    );
  };

  const [everestData, setEverestData] = useState<
    Maddie480EverestVersion[] | null
  >(null);

  useEffect(() => {
    fetch(
      'https://maddie480.ovh/celeste/everest-versions?supportsNativeBuilds=true'
    )
      .then((v) => v.json())
      .then((v) => setEverestData(v));
  }, []);

  const showManualVersionPopup = () => {
    createPopup(() => {
      const { hide } = useContext(PopupContext);
      const [manualVersion, setManualVersion] = useState(currentEverestVersion || '');

      return (
        <div className="popup-content manual-everest-popup">
          <div className="title">{_i18n.t('手动指定 Everest 版本')}</div>
          <div className="content">
            <p>{_i18n.t('如果你已经安装了 Everest，但 CeleMod 没有正确识别，可以在这里手动填写版本号。')}</p>
            <p>{_i18n.t('注意：如果实际上没有安装 Everest，就无法通过 Mod 方式启动游戏。')}</p>
            <input
              type="text"
              value={manualVersion}
              placeholder={_i18n.t('例如 4000')}
              onInput={(e) => setManualVersion((e.target as HTMLInputElement).value)}
            />
          </div>
          <div className="buttons">
            <button onClick={hide}>{_i18n.t('取消')}</button>
            <button
              onClick={() => {
                const version = manualVersion.trim();
                if (!version) return;
                setCurrentEverestVersion(version);
                hide();
              }}
            >
              {_i18n.t('确认')}
            </button>
          </div>
        </div>
      );
    });
  };

  return (
    <div className="everest">
      <img src={everest} alt="" srcset="" width={300} />

      <div className="line">
        {currentEverestVersion.length > 0 ? (
          <Fragment>
            <span className="ico">
              <Icon name="i-asterisk" />
            </span>
            <span className="ti">{_i18n.t('当前安装的 Everest 版本')}</span>
            <span className="value">{currentEverestVersion}</span>
          </Fragment>
        ) : (
          <span className="ti">{_i18n.t('未安装 Everest')}</span>
        )}
      </div>
      <div className="manual-everest-version" onClick={showManualVersionPopup}>
        {_i18n.t('我已安装 Everest，但未显示')}
      </div>
      {installingUrl === null ? (
        <Fragment>
          {everestData ? (
            <Fragment>
              <div className="channels">
                <Channel
                  title={_i18n.t('Stable 通道')}
                  branch="Stable"
                  dataFull={everestData}
                  onInstall={(url) => installEverest(url)}
                />

                <Channel
                  title={_i18n.t('Beta 通道')}
                  branch="Beta"
                  dataFull={everestData}
                  onInstall={(url) => installEverest(url)}
                />

                <Channel
                  branch="Dev"
                  title={_i18n.t('Dev 通道')}
                  dataFull={everestData}
                  onInstall={(url) => installEverest(url)}
                />
              </div>
            </Fragment>
          ) : (
            <div
              style={{
                horizontalAlign: 'center',
              }}
            >
              <ProgressIndicator infinite />
            </div>
          )}
        </Fragment>
      ) : (
        <Fragment>
          <div className="installing">
            {installState === 'Failed' ? (
              <Fragment>
                <div className="wrapperin">
                  <Icon name="i-cross" />
                </div>
                <div className="tip">{_i18n.t('安装失败')}</div>
                <div className="url">{installingUrl}</div>
                <div className="state">
                  <textarea>{failedReason}</textarea>
                </div>
                <div className="state">
                  <Button onClick={() => setInstallingUrl(null)}>
                    {_i18n.t('取消')}
                  </Button>
                </div>
              </Fragment>
            ) : installState === 'Success' ? (
              <Fragment>
                <div className="wrapperin">
                  <Icon name="i-tick" />
                </div>
                <div className="tip">{_i18n.t('安装成功')}</div>
                <div className="url">{installingUrl}</div>
                <div className="state">
                  <Button onClick={() => setInstallingUrl(null)}>
                    {_i18n.t('确认')}
                  </Button>
                </div>
              </Fragment>
            ) : (
              <Fragment>
                <div className="wrapperin">
                  <ProgressIndicator
                    {...(installProgress
                      ? {
                        value: installProgress,
                        max: 100,
                      }
                      : {
                        infinite: true,
                      })}
                  />
                </div>
                <div className="tip">
                  {installState === 'Downloading Everest'
                    ? _i18n.t('正在下载')
                    : _i18n.t('正在安装')}
                </div>
                <div className="url">{installingUrl}</div>
                <div className="state">{installState}</div>
              </Fragment>
            )}
          </div>
        </Fragment>
      )}
    </div>
  );
};
