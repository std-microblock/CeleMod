import { useEffect } from "react";
import { useAppStore, useEnableAcrylic } from "../states";
import { invokeCommand } from "../tauri/commands";
import { detectDesktopPlatform } from "../tauri/window";
import { getTheme, THEME_REGISTRY, type ThemeId } from "../themes/registry";
import { mountFluentInteractions } from "../styles/themes/fluent/runtime";
import { installMaterialYouInteractions } from "../styles/themes/material-you";

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
    root.style.setProperty("--theme-features", definition.features.join(" "));
    // Expose registry metadata under --theme-* without writing inline
    // semantic tokens (--bg, --color-*, --radius-*, --shadow-*) onto <html>,
    // which would override the CSS cascade in html[data-theme="..."] sheets.
    for (const [name, value] of Object.entries(definition.variables)) {
      root.style.setProperty(`--theme-${name}`, value);
    }
  }, [theme]);

  useEffect(() => {
    switch (theme) {
      case "fluent":
        return mountFluentInteractions();
      case "material-you":
        return installMaterialYouInteractions();
      default:
        return undefined;
    }
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
