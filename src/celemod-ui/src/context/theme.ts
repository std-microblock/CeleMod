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
    for (const [name, value] of Object.entries(definition.variables)) {
      root.style.setProperty(`--${name}`, value);
      root.style.setProperty(`--theme-${name}`, value);
    }
    // Keep the semantic aliases used by consolidated component styles in
    // sync with the active theme as well.
    const aliases: Record<string, string> = {
      "--color-canvas": "--bg",
      "--color-surface": "--bg",
      "--color-surface-elevated": "--bg1",
      "--color-surface-hover": "--bg2",
      "--color-surface-active": "--bg3",
      "--color-fg": "--fg",
      "--color-fg-muted": "--fg1",
      "--color-fg-subtle": "--fg2",
      "--color-fg-disabled": "--fg3",
      "--color-primary": "--primary",
      "--radius-sm": "--radius",
      "--radius-md": "--radius",
      "--shadow-card": "--elevation",
      "--shadow-button": "--elevation",
      "--scrollbar-thumb": "--bg3",
    };
    for (const [alias, token] of Object.entries(aliases))
      root.style.setProperty(alias, `var(${token})`);
    root.style.setProperty("--theme-features", definition.features.join(" "));
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
