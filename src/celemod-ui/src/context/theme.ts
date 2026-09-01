import { useEffect } from "react";
import { useAppStore, useEnableAcrylic } from "../states";
import { invokeCommand } from "../tauri/commands";
import { detectDesktopPlatform } from "../tauri/window";
import { getTheme, THEME_REGISTRY, type ThemeId } from "../themes/registry";

export { useEnableAcrylic } from "../states";
export { THEME_REGISTRY, getTheme };

export const createThemeContext = () => {
  const { enableAcrylic, setEnableAcrylic } = useEnableAcrylic();
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);

  useEffect(() => {
    const root = document.documentElement;
    const definition = getTheme(theme);
    root.setAttribute("data-theme", definition.id);
    root.style.setProperty("--theme-id", definition.id);
    for (const [name, value] of Object.entries(definition.variables)) {
      root.style.setProperty(`--${name}`, value);
      root.style.setProperty(`--theme-${name}`, value);
    }
    root.style.setProperty("--theme-features", definition.features.join(" "));
  }, [theme]);

  useEffect(() => {
    if (enableAcrylic)
      document.documentElement.setAttribute("window-blurbehind", "enabled");
    else document.body.parentElement?.removeAttribute("window-blurbehind");

    const platform = detectDesktopPlatform();
    if (platform !== "linux") {
      void invokeCommand("set_window_vibrancy", {
        enabled: enableAcrylic,
      }).catch(console.error);
    }
  }, [enableAcrylic]);

  return {
    enableAcrylic,
    setEnableAcrylic,
    theme,
    setTheme: (value: ThemeId) => setTheme(value),
    themes: THEME_REGISTRY,
    themeDefinition: getTheme(theme),
  };
};
