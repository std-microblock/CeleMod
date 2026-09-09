import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const backend = read("../../../src-tauri/src/backend.rs");

// run_mobile_plugin uses a blocking channel receive. Even when Kotlin uses a
// worker, a synchronous Tauri command prevents the WebView from polling/cancelling.
for (const name of ["start_game", "start_game_directly", "restart_game_with_loader"]) {
  test(`${name} leaves the IPC thread and waits on the blocking worker`, () => {
    const declaration = backend.match(new RegExp(`#\\[tauri::command\\]\\s+(async\\s+)?fn ${name}\\([^]*?\\n\\}`))?.[0];
    assert.ok(declaration, `${name} command must exist`);
    assert.match(declaration, new RegExp(`async fn ${name}\\(`));
    assert.match(declaration, /tauri::async_runtime::spawn_blocking\(move \|\|/);
    assert.match(declaration, /\.await/);
  });
}

test("launch sync clears stale progress before runtime startup and propagates failure", () => {
  const bridge = read("../../../android/runtime/src/com/celemod/runtime/SteamBridge.kt");
  const exclusive = bridge.slice(bridge.indexOf("private fun exclusive("), bridge.indexOf("fun command("));
  assert.match(exclusive, /JSONObject\(\)\.put\("stage", "connecting"\)/);
  assert.ok(exclusive.indexOf('"connecting"') < exclusive.indexOf("block()"));
  assert.match(exclusive, /throw e/);
  assert.match(exclusive, /finally \{ active.set\(false\) \}/);
});
