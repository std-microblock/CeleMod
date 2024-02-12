import _i18n from 'src/i18n';
import { h } from 'preact';
import { Icon } from './Icon';
import './GameSelector.scss';
import { callRemote, useBlockingMask } from '../utils';
import { useGamePath } from 'src/states';

export const GameSelector = (props: {
  paths: string[];
  onSelect: any;
  launchGame: (v: string) => void;
}) => {
  if (!props.paths.length) return <div>No games found</div>;
  const [gamePath] = useGamePath();

  if (!props.paths.includes(gamePath)) {
    props.paths.push(gamePath);
  }

  return (
    <div class="gameSelector">
      <div className="title">
        <Icon name="save" />
        <span>{_i18n.t('选择游戏路径')}</span>
      </div>
      <select onChange={props.onSelect} value={gamePath || props.paths[0]}>
        {props.paths.map((p) => (
          <option value={p}>{p}</option>
        ))}
        <option value="__other__">{_i18n.t('选择其他路径')}</option>
      </select>

      <button
        style={{ marginLeft: 5, borderRadius: 4 }}
        onClick={() => {
          props.launchGame('everest');
        }}
      >
        {_i18n.t('启动 Everest')}
      </button>

      <button
        style={{ marginLeft: 5, borderRadius: 4 }}
        onClick={() => {
          props.launchGame('origin');
        }}
      >
        {_i18n.t('启动 原版')}
      </button>

      <button
        style={{ marginLeft: 5, borderRadius: 4 }}
        onClick={() => {
          callRemote('open_url', (gamePath || props.paths[0]) + '/Mods');
        }}
      >
        {_i18n.t('Mods 文件夹')}
      </button>
    </div>
  );
};
