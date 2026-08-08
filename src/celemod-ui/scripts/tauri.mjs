import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(uiRoot, "../..");
const cli = resolve(uiRoot, "node_modules/@tauri-apps/cli/tauri.js");
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
