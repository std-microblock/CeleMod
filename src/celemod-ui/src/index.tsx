import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.scss";
import "./i2.css";
import { initializeWindowChrome } from "./tauri/window";
import { initializeCeleModDeepLinks } from "./deepLink";
import { initializeFrontendLogging } from "./logging";
import { ThemePreview } from "./themePreview";

initializeFrontendLogging();
initializeWindowChrome();
void initializeCeleModDeepLinks().catch((error) =>
  console.error("Failed to initialize CeleMod deep links", error),
);

const root = document.getElementById("root")!;
createRoot(root).render(
  import.meta.env.DEV && window.location.pathname === "/__theme-preview" ? (
    <ThemePreview />
  ) : (
    <App />
  ),
);
