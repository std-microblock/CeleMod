import _i18n from 'src/i18n';

import { h } from 'preact';
import { useGamePath } from '../states';
import { Mod } from '../components/ModList';
import { Button } from '../components/Button';
import { useState, useEffect } from 'react';
import { callRemote } from '../utils';
import { enforceEverest } from '../components/EnforceEverestPage';

export const Multiplayer = () => {
  const noEverest = enforceEverest();
  if (noEverest) return noEverest;

  const [selectedPath] = useGamePath();

  const [installedMiaoNet, setInstalledMiaoNet] = useState(false);

  useEffect(() => {
    callRemote(
      'get_installed_miaonet',
      selectedPath + '/Mods',
      (installed: boolean) => {
        console.log(installed);
        setInstalledMiaoNet(installed);
      }
    );
  }, [selectedPath]);

  return (
    <div className="multiplayer">
      <h1>
        Ⅰ&nbsp;
        {_i18n.t('安装 Mod')}
      </h1>
      <p>{_i18n.t('为了在蔚蓝群服进行联机，你需要安装以下 Mod')}</p>

      <Mod
        mod={{
          name: 'Celeste.Miao.Net',
          author: 'MiaoWoo',
          other: _i18n.t('蔚蓝群服联机 Mod'),
          downloadUrl: () =>
            Promise.resolve(
              'https://celeste.weg.fan/api/v2/download/mods/Miao.CelesteNet.Client'
            ),
          previewUrl:
            'https://images.gamebanana.com/img/Webpage/Game/Profile/Background/5b05699bd0a6b.jpg',
        }}
        modFolder={selectedPath + '/Mods'}
        isInstalled={installedMiaoNet}
      />

      <h1>
        Ⅱ&nbsp;
        {_i18n.t('注册账号')}
      </h1>
      <p>{_i18n.t('你需要在 Celeste 群服论坛 注册一个账号')}</p>
      <Button
        onClick={() => {
          callRemote('open_url', 'https://celeste.centralteam.cn/');
        }}
      >
        {_i18n.t('进入注册页')}
      </Button>

      <h1>
        Ⅲ&nbsp;
        {_i18n.t('登录账号')}
      </h1>
      <p>{_i18n.t('打开游戏后，你将需要在 Mod 设置中启用并登录群服 Mod')}</p>

      <style
        dangerouslySetInnerHTML={{
          __html: `small{
                font-size: 15px;
                font-weight: 400;
            }`,
        }}
      ></style>
    </div>
  );
};
