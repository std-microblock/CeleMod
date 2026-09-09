// Local fixture only; no native IPC, device files or Steam credentials are read.
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const stub = fileURLToPath(new URL("./stubs.ts", import.meta.url));
const server = await createServer({
  configFile: false, root, optimizeDeps: { entries: ["tests/android-logs/index.html"] },
  plugins: [{ name: "log-viewer-fixture", enforce: "pre", resolveId(source, importer) {
    if (importer?.replaceAll("\\", "/").endsWith("/components/AndroidLogs.tsx") && ["../i18n", "@tauri-apps/api/core"].includes(source)) return stub;
  } }, react()],
  server: { host: "127.0.0.1", port: 1428, strictPort: true },
});
await server.listen();
console.log("Android logs fixture: http://127.0.0.1:1428/tests/android-logs/");
