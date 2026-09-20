import { useEffect, useState } from "react";
import { THEME_REGISTRY, type ThemeId } from "./themes/registry";
import { installMaterialYouInteractions } from "./styles/themes/material-you";
import { mountFluentInteractions } from "./styles/themes/fluent/runtime";

const applyTheme = (id: ThemeId) => {
  const root = document.documentElement;
  const theme =
    THEME_REGISTRY.find((item) => item.id === id) ?? THEME_REGISTRY[0];
  root.dataset.theme = theme.id;
  for (const [key, value] of Object.entries(theme.variables))
    root.style.setProperty(`--${key}`, value);
};

const sampleRows = [
  "Strawberry Jam",
  "Everest Core",
  "Collab Utilities",
  "Celeste 64",
];

export function ThemePreview() {
  const [theme, setTheme] = useState<ThemeId>("vanilla");
  useEffect(() => {
    applyTheme(theme);
    const cleanup =
      theme === "material-you"
        ? installMaterialYouInteractions()
        : theme === "fluent"
          ? mountFluentInteractions()
          : undefined;
    return cleanup;
  }, [theme]);
  return (
    <div className="app-frame theme-preview-app">
      <header className="window-titlebar">
        <strong className="window-caption">CeleMod Theme Preview</strong>
      </header>
      <div className="app-shell">
        <nav className="sidebar">
          <div className="sidebar-items">
            {[
              ["home", "Home"],
              ["search", "Search"],
              ["drive", "Manage"],
              ["settings", "Settings"],
            ].map(([icon, label], index) => (
              <button
                className={`navBtn ${index === 0 ? "selected" : ""}`}
                key={label}
              >
                <span className="icon">●</span>
                <span className="title">{label}</span>
              </button>
            ))}
          </div>
        </nav>
        <main className="app-content theme-preview-content">
          <section className="settings-page page-Settings">
            <header className="settings-header">
              <h1>Theme preview</h1>
              <p>Representative surfaces and interactions</p>
            </header>
            <div className="theme-preview-switcher">
              {THEME_REGISTRY.map((item) => (
                <button
                  key={item.id}
                  className={item.id === theme ? "selected" : ""}
                  onClick={() => setTheme(item.id as ThemeId)}
                >
                  {item.name}
                </button>
              ))}
            </div>
            <div className="settings-columns">
              <section className="settings-section">
                <div className="settings-section-title">
                  <span>HOME</span>
                </div>
                <div className="settings-card home-profiles-section">
                  <div className="card-grid">
                    {sampleRows.map((name) => (
                      <article className="mod-card profile" key={name}>
                        <h2>{name}</h2>
                        <p>Enabled profile with dependencies and metadata</p>
                        <button className="primary">Open</button>
                      </article>
                    ))}
                  </div>
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-section-title">
                  <span>SEARCH / MANAGE</span>
                </div>
                <div className="settings-card search-page manage-page">
                  <div className="linear-command-bar">
                    <input placeholder="Search mods…" />
                    <button className="primary">⌘ K</button>
                  </div>
                  <div className="mod-list">
                    {sampleRows.map((name, index) => (
                      <div className="mod-row search-result-card" key={name}>
                        <span>
                          <strong>{name}</strong>
                          <small>v{index + 1}.2.0 · 12 MB</small>
                        </span>
                        <button>Install</button>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-section-title">
                  <span>CONTROLS / OVERLAYS</span>
                </div>
                <div className="settings-card">
                  <div className="setting-toggle-row">
                    <span>
                      <strong>Enable acrylic</strong>
                      <small>Window material and transient surfaces</small>
                    </span>
                    <input type="checkbox" defaultChecked />
                  </div>
                  <div className="setting-select-row">
                    <span>
                      <strong>Download source</strong>
                      <small>Choose a mirror</small>
                    </span>
                    <select defaultValue="wegfan">
                      <option value="wegfan">WEGFan</option>
                      <option value="gamebanana">GameBanana</option>
                    </select>
                  </div>
                  <div className="theme-preview-actions">
                    <button className="primary">Save changes</button>
                    <button data-snackbar="Saved">Show snackbar</button>
                  </div>
                </div>
              </section>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
