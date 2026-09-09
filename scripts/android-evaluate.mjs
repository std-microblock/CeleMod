// Evaluate a test expression in CeleMod's DEBUG WebView via an adb-forwarded CDP port.
// Usage: adb forward tcp:9223 localabstract:webview_devtools_remote_<PID>
//        node scripts/android-evaluate.mjs 'document.body.innerText'
// This is a local test helper, never shipped inside the APK.
import { readFileSync } from "node:fs";
const expression = process.argv[2] === "--file" ? readFileSync(process.argv[3], "utf8") : process.argv[2];
if (!expression) throw new Error("Provide a JavaScript test expression or --file path");
const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
const target = targets.find(t => t.url.startsWith("http://tauri.localhost") || t.url.startsWith("https://tauri.localhost"));
if (!target) throw new Error("CeleMod WebView not found. Open the app and forward its debug socket.");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const timeout = setTimeout(() => { ws.close(); process.exitCode = 1; console.error("CDP evaluation timed out"); }, 330_000);
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id !== 1) return;
  clearTimeout(timeout);
  console.log(JSON.stringify(message.result ?? message.error, null, 2));
  if (message.error || message.result?.exceptionDetails) process.exitCode = 1;
  ws.close();
};
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true, userGesture: true } }));
