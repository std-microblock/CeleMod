import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("../../", import.meta.url)),
  optimizeDeps: { entries: ["tests/material-you-ripple/index.html"] },
  server: { host: "127.0.0.1", port: 1428, strictPort: true },
});
await server.listen();
console.log("Ripple fixture: http://127.0.0.1:1428/tests/material-you-ripple/");
