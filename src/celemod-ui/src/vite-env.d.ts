/// <reference types="vite/client" />

interface Window {
  _checkUpdate(forceRefresh?: boolean): Promise<void>;
  env: any;
  isMaximizable: boolean;
  storage: any;
  sys: any;
}
