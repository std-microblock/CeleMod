import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const stub = fileURLToPath(new URL("./stubs.tsx", import.meta.url));
const server = await createServer({
  configFile: false, root, optimizeDeps: { entries: ["tests/android-miaonet/index.html"] },
  plugins: [{ name: "miaonet-fixture", enforce: "pre", resolveId(source, importer) {
    if (importer?.replaceAll("\\", "/").endsWith("/routes/Multiplayer.tsx") &&
      !source.startsWith("react") && source !== "./Multiplayer.scss" && !source.startsWith("/")) return stub;
  } }, react()],
  server: { host: "127.0.0.1", port: 1431, strictPort: true },
});
await server.listen();
console.log("MiaoNet fixture: http://127.0.0.1:1431/tests/android-miaonet/");
