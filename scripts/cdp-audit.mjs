import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";

const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("No Tauri page target found");
const socket = net.createConnection({ host: "127.0.0.1", port: 9222 });
await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
let buffer = Buffer.alloc(0); let handshaken = false; let nextId = 0;
const pending = new Map();
socket.write(`GET /devtools/page/${target.id} HTTP/1.1\r\nHost: 127.0.0.1:9222\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
function parse() {
  if (!handshaken) { const end = buffer.indexOf(Buffer.from("\r\n\r\n")); if (end < 0) return; buffer = buffer.subarray(end + 4); handshaken = true; }
  while (buffer.length >= 2) {
    const first = buffer[0];
    const second = buffer[1]; let length = second & 127; let offset = 2;
    if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
    else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
    if (second & 128) offset += 4; if (buffer.length < offset + length) return;
    let payload = buffer.subarray(offset, offset + length); buffer = buffer.subarray(offset + length);
    if (second & 128) { const mask = buffer.subarray(offset - 4, offset); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]; }
    if ((first & 0x0f) !== 1) continue;
    const message = JSON.parse(payload.toString()); const callback = pending.get(message.id);
    if (callback) { pending.delete(message.id); callback(message); }
  }
}
socket.on("data", (data) => { buffer = Buffer.concat([buffer, data]); parse(); });
function send(object) { const payload = Buffer.from(JSON.stringify(object)); const mask = crypto.randomBytes(4); const header = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length]) : Buffer.from([0x81, 0xfe, payload.length >> 8, payload.length & 255]); const masked = Buffer.from(payload); for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4]; socket.write(Buffer.concat([header, mask, masked])); }
function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++nextId; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method}`)); }, 10000); pending.set(id, (value) => { clearTimeout(timer); resolve(value); }); send({ id, method, params }); }); }
const evaluate = async (expression) => (await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await wait(250);

const themes = [
  ["vanilla", "Vanilla"], ["material-you", "Material You"], ["fluent", "Fluent Design"],
  ["linear", "Linear / NextUI"], ["metro", "Windows 10 Metro"], ["material-2", "Material Design 2"],
];
const pages = [["Home", "主页"], ["Everest", "Everest"], ["Search", "搜索"], ["Manage", "管理"], ["KeyBindings", "按键"], ["Multiplayer", "联机相关"], ["RecommendMods", "推荐模组"], ["Loenn", "Loenn"], ["Settings", "设置"]];
const outputDir = process.argv[2] ?? "D:/CeleMod/tauri-audit";
fs.mkdirSync(outputDir, { recursive: true });
for (const [themeId, themeName] of themes) {
  await evaluate(`(() => { const settings = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('设置')); settings?.click(); return true; })()`);
  await wait(220);
  await evaluate(`(() => { const option = [...document.querySelectorAll('.theme-option')].find((b) => b.textContent?.includes(${JSON.stringify(themeName)})); option?.click(); return true; })()`);
  await wait(350);
  for (const [pageId, pageLabel] of pages) {
    const clicked = await evaluate(`(() => { const button = [...document.querySelectorAll('.navBtn')].find((b) => b.textContent?.includes(${JSON.stringify(pageLabel)})); if (!button) return false; button.click(); return true; })()`);
    if (!clicked) continue;
    await wait(220);
    const file = `${outputDir}/${themeId}-${pageId}.png`;
    const screenshot = await call("Page.captureScreenshot", { format: "png" });
    if (screenshot.result?.data) fs.writeFileSync(file, Buffer.from(screenshot.result.data, "base64"));
    const state = await evaluate(`JSON.stringify({theme: document.documentElement.dataset.theme, page: document.querySelector('.page:not([hidden])')?.className})`);
    console.log(`${themeId}/${pageId}: ${state}`);
  }
}
socket.end();
