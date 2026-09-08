// Local-only fixture: real SteamAccount, theme provider/styles/runtimes, fake native IPC.
// Run from this package: node tests/steam-ui/serve.mjs
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const stub = fileURLToPath(new URL("./stubs.ts", import.meta.url));
const server = await createServer({
  configFile: false, root, optimizeDeps: { entries: ["tests/steam-ui/index.html"] },
  plugins: [{ name: "steam-fixture-only", enforce: "pre", resolveId(source, importer) {
    if (source === "virtual:steam-mobile-style") return "\0steam-mobile-style";
    if (importer?.replaceAll("\\", "/").endsWith("/components/SteamAccount.tsx") && ["../App", "../states"].includes(source)) return stub;
    if (importer?.replaceAll("\\", "/").endsWith("/context/theme.ts") && ["../states", "../tauri/commands"].includes(source)) return stub;
  }, load(id) {
    // Android layout can be developed separately; test it whenever present.
    if (id === "\0steam-mobile-style") return existsSync(`${root}/src/styles/android.scss`) ? 'import "/src/styles/android.scss";' : "";
  } }, react()],
  server: { host: "127.0.0.1", port: 1427, strictPort: true },
});
await server.listen();
console.log("Steam theme fixture: http://127.0.0.1:1427/tests/steam-ui/");
