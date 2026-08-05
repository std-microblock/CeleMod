import { getCurrentWindow } from '@tauri-apps/api/window';
import { callRemote } from './commands';

export function initializeWindowChrome() {
  const appWindow = getCurrentWindow();

  document.querySelector('#window-minimize')?.addEventListener('click', () => {
    void appWindow.minimize();
  });
  document.querySelector('#window-maximize')?.addEventListener('click', () => {
    void appWindow.toggleMaximize();
  });
  document.querySelector('#window-close')?.addEventListener('click', () => {
    void appWindow.close();
  });
  document.querySelector('.celemod-version')?.addEventListener('click', (event) => {
    if ((event as MouseEvent).shiftKey) void callRemote('show_log_window');
    else void window._checkUpdate?.();
  });

  void Promise.all([
    callRemote<string>('celemod_version'),
    callRemote<string>('celemod_hash'),
  ]).then(([version, hash]) => {
    const versionElement = document.querySelector<HTMLElement>('.caption-version');
    const hashElement = document.querySelector<HTMLElement>('.caption-hash');
    if (versionElement) versionElement.innerText = version;
    if (hashElement) hashElement.innerText = hash.slice(0, 6);
  }).catch(console.error);

  const platform = navigator.userAgent.includes('Windows')
    ? 'Windows'
    : navigator.userAgent.includes('Mac')
      ? 'macOS'
      : 'Linux';
  document.documentElement.setAttribute('platform', platform);
}
