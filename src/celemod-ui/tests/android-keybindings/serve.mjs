import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const stub = fileURLToPath(new URL("./stubs.ts", import.meta.url));
const server = await createServer({
  configFile: false, root, optimizeDeps: { entries: ["tests/android-keybindings/index.html"] },
  plugins: [{ name: "touch-buttons-fixture", enforce: "pre", resolveId(source, importer) {
    if (importer?.replaceAll("\\", "/").endsWith("/routes/AndroidKeyBindings.tsx") &&
      ["../i18n", "../states", "../utils"].includes(source)) return stub;
  } }, react()],
  server: { host: "127.0.0.1", port: 1430, strictPort: true },
});
await server.listen();
console.log("Touch buttons fixture: http://127.0.0.1:1430/tests/android-keybindings/");
