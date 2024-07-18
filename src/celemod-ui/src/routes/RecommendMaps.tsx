import { h } from 'preact';
import { enforceEverest } from 'src/components/EnforceEverestPage';
import { Icon } from 'src/components/Icon';
import './RecommendMaps.scss';
import _i18n, { useI18N } from 'src/i18n';

// @ts-ignore
import strawberryJamImg from '../resources/collabs/strawberry-jam.webp';
// @ts-ignore
import galleryCollabImg from '../resources/collabs/gallery-collab.webp';
// @ts-ignore
import springCollabImg from '../resources/collabs/spring-collab.webp';
// @ts-ignore
import theRoadLessTravelledImg from '../resources/collabs/the-road-less-travelled.webp';

import { callRemote, horizontalScrollMouseWheelHandler } from 'src/utils';
import { Button } from 'src/components/Button';
import { memo } from 'preact/compat';
import { useInstalledMods } from 'src/states';
import { useState } from 'react';
import { useGlobalContext } from 'src/App';

export const RecommendMaps = () => {
  // const noEverest = enforceEverest();
  // if (noEverest) return noEverest;

  const { installedMods } = useInstalledMods();
  const ctx = useGlobalContext();
  const InstallButton = ({ name, url }) => {
    const installed = installedMods.some((mod) => mod.name === name);
    const [state, setState] = useState(
      installed ? _i18n.t('已安装') : _i18n.t('安装')
    );

    const startDownload = () => {
      if (state !== _i18n.t('安装')) return;
      setState(_i18n.t('准备下载'));
      callRemote('get_mod_update', name, (data) => {
        if (!!data) {
          const [gbFileId, version] = JSON.parse(data);
          ctx.download.downloadMod(
            name,
            parseInt(gbFileId) === -1 ? url : gbFileId,
            {
              onProgress(task, progress) {
                setState(
                  `${progress}% (${
                    task.subtasks.filter((v) => v.state === 'Finished').length
                  }/${task.subtasks.length})`
                );
              },
              onFinished() {
                setState(_i18n.t('已安装'));
                ctx.modManage.reloadMods();
              },
              onFailed(task, error) {
                setState(_i18n.t('下载失败'));
              },
            }
          );
        }
      });
    };
    return <Button onClick={() => startDownload()}>{state}</Button>;
  };

  return (
    <div>
      <div className="rec-map">
        <h1>{_i18n.t('推荐的地图')}</h1>
        <p>{_i18n.t('这里将会列出一些推荐安装的地图及其简介，请按需安装')}</p>
        <div className="collabs">
          <div
            className="collab"
            style={{
              backgroundImage: `url(${strawberryJamImg})`,
            }}
          >
            <div className="intro">
              <div className="name">
                <Icon name="grid" />
                {_i18n.t('草莓酱')}
              </div>
              <div className="subtitle">
                <b>{_i18n.t('别名')}</b>
                {_i18n.t('酱游 / Strawberry Jam')}
              </div>

              <div className="desc">
                <p>{_i18n.t('最为经典的地图集，于 2023 年推出')}</p>
                <p>
                  {_i18n.t(
                    '质量极高，每张图都有自己的特色；背景音乐与环境制作精良'
                  )}
                </p>
                <p>
                  {_i18n.t(
                    '分为五个难度（即酱一至酱五），从刚入门的新手到千小时的老鸟都可以打~'
                  )}
                </p>
              </div>
              <div className="info">
                <span className="inf">
                  <Icon name="download" />
                  <span>~ 2 GiB</span>
                </span>
                &nbsp;
                <span className="inf">
                  <Icon name="clock" />
                  <span>2023-02</span>
                </span>
              </div>
            </div>
            <div className="oper">
              <InstallButton
                name="StrawberryJam2021"
                url="https://celeste.weg.fan/api/v2/download/mods/StrawberryJam2021"
              />
            </div>
          </div>

          <div
            className="collab"
            style={{
              backgroundImage: `url(${galleryCollabImg})`,
            }}
          >
            <div className="intro">
              <div className="name">
                <Icon name="grid" />
                {_i18n.t('画游')}
              </div>
              <div className="subtitle">
                <b>{_i18n.t('别名')}</b> 2024CNY / Gallery Collab
              </div>
              <div className="desc">
                <p>{_i18n.t('包含超过20张地图和一个极其漂亮的大厅')}</p>
                <p>
                  {_i18n.t(
                    '涵盖酱一至酱五所有难度，数种与众不同的新机制等待玩家去探索'
                  )}
                </p>
                <p>
                  {_i18n.t(
                    '国人原创图，国风浓厚，难度偏高，美术优美，音乐好听，非常推荐安装尝试'
                  )}
                </p>
              </div>
              <div className="info">
                <span className="inf">
                  <Icon name="download" />
                  <span>~ 400 MiB</span>
                </span>
                &nbsp;
                <span className="inf">
                  <Icon name="clock" />
                  <span>2024-03</span>
                </span>
              </div>
            </div>
            <div className="oper">
              <InstallButton
                name="ChineseNewYear2024Collab"
                url="https://celeste.weg.fan/api/v2/download/mods/ChineseNewYear2024Collab"
              />
            </div>
          </div>

          <div
            className="collab"
            style={{
              backgroundImage: `url(${springCollabImg})`,
            }}
          >
            <div className="intro">
              <div className="name">
                <Icon name="grid" />
                {_i18n.t('春游')}
              </div>
              <div className="subtitle">
                <b>{_i18n.t('别名')}</b> Spring Collab 2020
              </div>
              <div className="desc">
                <p>{_i18n.t('包含80+地图，5个章节，数十种新机制')}</p>
                <p>
                  {_i18n.t(
                    'Spring Collab 有 5 个大厅供您探索，里面装满了社区制作的地图。地图的难度从早期的原版内容到一些现存最难的 Celeste 地图均有覆盖'
                  )}
                </p>
                <p>{_i18n.t('老牌地图，比草莓酱简单，还行')}</p>
              </div>
              <div className="info">
                <span className="inf">
                  <Icon name="download" />
                  <span>~ 560 MiB</span>
                </span>
                &nbsp;
                <span className="inf">
                  <Icon name="clock" />
                  <span>2020-09</span>
                </span>
              </div>
            </div>
            <div className="oper">
              <InstallButton
                name="SpringCollab2020"
                url="https://celeste.weg.fan/api/v2/download/mods/SpringCollab2020"
              />
            </div>
          </div>

          <div
            className="collab"
            style={{
              backgroundImage: `url(${theRoadLessTravelledImg})`,
            }}
          >
            <div className="intro">
              <div className="name">
                <Icon name="image" />
                {_i18n.t('孤行路远')}
              </div>
              <div className="subtitle">
                <b>{_i18n.t('别名')}</b> the road less travelled
              </div>
              <div className="desc">
                <p>{_i18n.t('单图，美术和音乐都很好')}</p>
                <p>
                  {_i18n.t(
                    'MB 自己很喜欢的一张图，有 20-30 面，感觉很平和（中文名是自己翻译的）'
                  )}
                </p>
                <p>
                  {_i18n.t(
                    'A 面难度在 5A - 6A，B面/C面有一些技巧，难度在 7B 的样子'
                  )}
                </p>
              </div>
              <div className="info">
                <span className="inf">
                  <Icon name="download" />
                  <span>~ 50 MiB</span>
                </span>
                &nbsp;
                <span className="inf">
                  <Icon name="clock" />
                  <span>2021-12</span>
                </span>
              </div>
            </div>
            <div className="oper">
              <InstallButton
                name="the road less travelled"
                url="https://celeste.weg.fan/api/v2/download/mods/the%20road%20less%20travelled"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
