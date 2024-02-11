import _i18n from 'src/i18n';
import { h } from 'preact';
import { useGlobalContext } from '../App';
import { useCurrentEverestVersion } from '../states';
import { Button } from './Button';
import { Icon } from './Icon';

export const enforceEverest = () => {
  const { pageController } = useGlobalContext();
  const { currentEverestVersion } = useCurrentEverestVersion();
  if (!currentEverestVersion)
    return (
      <div class="no-everest">
        <h2>{_i18n.t('请先安装 Everest')}</h2>
        <pre>
          {_i18n.t(
            'Everest 是 Celeste 的开源模组加载器和模组 API，允许您根据自己的喜好创 建自定义地图包、纹理替换和代码模组。 必须先安装 Everest 才能使用 Mod。 CeleMod 可以帮助你一键下载和安装 Everest。',
            {}
          )}
        </pre>
        <div>
          <Button
            onClick={() => {
              pageController.setPage('Everest');
            }}
          >
            <Icon name="download" />
            {_i18n.t('转到 Everest 页')}
          </Button>
        </div>
      </div>
    );
};
