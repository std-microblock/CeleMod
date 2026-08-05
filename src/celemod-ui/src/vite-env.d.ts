/// <reference types="vite/client" />

interface Window {
  _checkUpdate(): Promise<void>;
  env: any;
  isMaximizable: boolean;
  storage: any;
  sys: any;
}
