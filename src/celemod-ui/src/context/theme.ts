import { useEffect } from 'react';
import { useEnableAcrylic } from '../states';
import { invokeCommand } from '../tauri/commands';
import { detectDesktopPlatform } from '../tauri/window';

export { useEnableAcrylic } from '../states';

export const createThemeContext = () => {
  const { enableAcrylic, setEnableAcrylic } = useEnableAcrylic();

  useEffect(() => {
    if (enableAcrylic)
      document.documentElement.setAttribute('window-blurbehind', 'enabled');
    else document.body.parentElement?.removeAttribute("window-blurbehind");

    const platform = detectDesktopPlatform();
    if (platform !== 'linux') {
      void invokeCommand('set_window_vibrancy', { enabled: enableAcrylic }).catch(console.error);
    }
  }, [enableAcrylic]);

  return {
    enableAcrylic,
    setEnableAcrylic,
  };
};
