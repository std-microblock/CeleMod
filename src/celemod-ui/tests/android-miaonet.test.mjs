import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const backend = read("../../../src-tauri/src/backend.rs");

for (const name of ["start_miaonet_oauth", "save_miaonet_settings", "logout_miaonet"]) {
  test(`${name} keeps blocking Android plugin calls off the WebView thread`, () => {
    const command = backend.match(new RegExp(`#\\[tauri::command\\]\\s+async fn ${name}\\([^]*?\\n\\}`))?.[0];
    assert.ok(command);
    assert.match(command, /tauri::async_runtime::spawn_blocking/);
    assert.match(command, /\.await/);
  });
}
test("native game status covers both running and queued launches", () => {
  const plugin = read("../../../android/runtime/src/com/celemod/runtime/RuntimePlugin.kt");
  assert.match(plugin, /fun gameState[^]*?gameRunning\(\) \|\| SteamBridge.launching/);
  assert.match(plugin, /processName == activity.packageName \+ ":game"/);
});
test("authorization rechecks the game before saving and binds both loopbacks", () => {
  assert.match(backend, /ensure_miaonet_game_stopped\(game_path\)\?;\s*miaonet_oauth_event\(game_path, on_event, "saving_token"/);
  assert.match(backend, /TcpListener::bind\(\("127\.0\.0\.1", 21472\)\)/);
  assert.match(backend, /TcpListener::bind\(\("::1", 21472\)\)/);
});

test("Android authorization starts a bounded foreground service before opening the browser", () => {
  const plugin = read("../../../android/runtime/src/com/celemod/runtime/RuntimePlugin.kt");
  const command = plugin.slice(plugin.indexOf("@Command fun openMiaoNetAuth"), plugin.indexOf("@Command fun finishMiaoNetAuth"));
  assert.ok(command.indexOf("startForegroundService") < command.indexOf("activity.startActivity"));
  const service = read("../../../android/runtime/src/com/celemod/runtime/MiaoNetAuthService.kt");
  assert.match(service, /startForeground\(21472/);
  assert.match(service, /postDelayed\(expire, 360_000\)/);
  assert.match(backend, /impl Drop for MiaoNetOauthGuard[^]*?finish_miaonet_auth/);
});
