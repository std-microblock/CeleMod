import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.scss";
import "./i2.css";
import { initializeWindowChrome } from "./tauri/window";
import { initializeCeleModDeepLinks } from "./deepLink";

initializeWindowChrome();
void initializeCeleModDeepLinks().catch((error) =>
  console.error("Failed to initialize CeleMod deep links", error),
);

createRoot(document.getElementById("root")!).render(<App />);
