import { useEffect } from 'react';
import { Effect, getCurrentWindow } from '@tauri-apps/api/window';
import { useEnableAcrylic } from '../states';

export { useEnableAcrylic } from '../states';

export const createThemeContext = () => {
  const { enableAcrylic, setEnableAcrylic } = useEnableAcrylic();

  useEffect(() => {
    if (enableAcrylic)
      document.documentElement.setAttribute('window-blurbehind', 'enabled');
    else document.body.parentElement?.removeAttribute("window-blurbehind");
    void getCurrentWindow().setEffects({ effects: enableAcrylic ? [Effect.Mica] : [] }).catch(console.error);
  }, [enableAcrylic]);

  return {
    enableAcrylic,
    setEnableAcrylic,
  };
};
