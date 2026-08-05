import { type ComponentType, useEffect, useState } from 'react';
import { FiMinus, FiSquare, FiX } from 'react-icons/fi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { callRemote } from '../tauri/commands';
import { detectDesktopPlatform } from '../tauri/window';

export function WindowTitlebar() {
  const [version, setVersion] = useState('');
  const [hash, setHash] = useState('');
  const platform = detectDesktopPlatform();

  useEffect(() => {
    if (platform !== 'windows') return;
    void Promise.all([
      callRemote<string>('celemod_version'),
      callRemote<string>('celemod_hash'),
    ]).then(([nextVersion, nextHash]) => {
      setVersion(nextVersion);
      setHash(nextHash.slice(0, 6));
    }).catch(console.error);
  }, [platform]);

  if (platform !== 'windows') return null;
  const appWindow = getCurrentWindow();
  const MinusIcon = FiMinus as unknown as ComponentType;
  const MaximizeIcon = FiSquare as unknown as ComponentType;
  const CloseIcon = FiX as unknown as ComponentType;

  return (
    <header className="window-titlebar">
      <div className="window-caption" data-tauri-drag-region>CeleMod</div>
      <button
        className="celemod-version"
        title="点击检查更新 / Check Update"
        onClick={(event) => {
          if (event.shiftKey) void callRemote('show_log_window');
          else void window._checkUpdate?.();
        }}
      >
        <span className="caption-hash">{hash}</span>
        <span className="caption-version">{version}</span>
      </button>
      <div className="win-ctrl">
        <button aria-label="Minimize" onClick={() => void appWindow.minimize()}><MinusIcon /></button>
        <button aria-label="Maximize" onClick={() => void appWindow.toggleMaximize()}><MaximizeIcon /></button>
        <button className="close" aria-label="Close" onClick={() => void appWindow.close()}><CloseIcon /></button>
      </div>
    </header>
  );
}
