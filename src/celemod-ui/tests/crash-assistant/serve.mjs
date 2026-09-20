// Local-only fixture: real CrashAssistant component, styles and popup plumbing.
// Run from this package: node tests/crash-assistant/serve.mjs
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../", import.meta.url));
const stub = fileURLToPath(new URL("./stubs.ts", import.meta.url));
const stubbed = [
  "./states",
  "../states",
  "../App",
  "../utils",
  "../stores/download",
  "../api/updateInfo",
  "../api/crashModFix",
  "../lib/http",
];

const server = await createServer({
  configFile: false,
  root,
  resolve: {
    alias: {
      locales: resolve(root, "locales"),
      src: resolve(root, "src"),
    },
  },
  optimizeDeps: { entries: ["tests/crash-assistant/index.html"] },
  plugins: [
    {
      name: "crash-assistant-fixture",
      enforce: "pre",
      resolveId(source, importer) {
        if (!importer) return undefined;
        if (!importer.replaceAll("\\", "/").includes("/src/")) return undefined;
        return stubbed.includes(source) ? stub : undefined;
      },
    },
    react(),
  ],
  server: { host: "127.0.0.1", port: 1429, strictPort: true },
});
await server.listen();
console.log(
  "Crash assistant fixture: http://127.0.0.1:1429/tests/crash-assistant/",
);
