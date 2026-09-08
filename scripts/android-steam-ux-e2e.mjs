// Deterministic UX tests in the installed DEBUG Android WebView. No real Steam
// login/download/cloud request is sent. Mock IPC is removed by reload in finally.
// Forward WebView CDP to 9223 first (see docs/android-steam.md).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const out = resolve(".local/steam-ux");
mkdirSync(out, { recursive: true });
const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
const target = targets.find(t => /^https?:\/\/tauri.localhost/.test(t.url));
assert.ok(target, "Open CeleMod and forward its debug WebView to port 9223");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
let sequence = 0;
const pending = new Map();
const errors = [];
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id); clearTimeout(request.timer);
  if (message.error) request.fail(new Error(JSON.stringify(message.error)));
  else request.ok(message.result);
};
const cdp = (method, params = {}) => new Promise((ok, fail) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); fail(new Error(`Timeout: ${method}`)); }, 15000);
  pending.set(id, { ok, fail, timer }); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const androidBack = () => {
  const adb = resolve(".local/android-sdk/platform-tools/adb.exe");
  const windows = execFileSync(adb, ["shell", "dumpsys", "window"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  assert.match(windows, /mCurrentFocus=.*cc\.microblock\.celemod\/.*MainActivity/, "Do not send Back to another app");
  execFileSync(adb, ["shell", "input", "keyevent", "4"]);
};
async function wait(expression) {
  for (let i = 0; i < 70; i++) { if (await evaluate(expression)) return; await sleep(100); }
  throw new Error(`Not ready: ${expression}`);
}
const check = async (expression, message) => assert.ok(await evaluate(expression), message);
const click = async selector => {
  await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(80);
};
const button = async label => {
  const expression = `[...document.querySelectorAll('.steam-sheet[open] button')].find(e => e.textContent.trim() === ${JSON.stringify(label)})`;
  await wait(`!!(${expression})`); await evaluate(`(${expression}).click()`); await sleep(80);
};
const fill = (selector, value) => evaluate(`(() => {
  const e=document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});
  e.dispatchEvent(new Event('input',{bubbles:true}));
})()`);
const idle = { account: "", steamId: "", busy: false, cloud: true, offline: false, pending: false, stage: "signed-out" };
const signedIn = { ...idle, account: "ux_test_account", steamId: "76561198000000000", stage: "complete", operation: "login" };
const setStatus = async status => { await evaluate(`window.__steamUX.status=${JSON.stringify(status)}`); await sleep(1250); };
const screen = name => wait(`document.querySelector('.steam-sheet[open] [data-steam-screen]')?.dataset.steamScreen===${JSON.stringify(name)}`);
const report = [];
async function capture(name) {
  const layout = await evaluate(`(() => {
    const d=document.querySelector('.steam-sheet[open]'); const r=d?.getBoundingClientRect();
    return {width:innerWidth,height:innerHeight,screen:d?.querySelector('[data-steam-screen]')?.dataset.steamScreen,
      horizontalOverflow:d ? d.scrollWidth>d.clientWidth+1:false,
      fullWidth:!r || innerWidth>540 || r.width>=innerWidth-1,
      inViewport:!r || (r.left>=-1 && r.right<=innerWidth+1 && r.top>=-1 && r.bottom<=innerHeight+1),
      controls:d?[...d.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>({label:e.textContent.trim()||e.getAttribute('aria-label'),height:e.getBoundingClientRect().height})):[]};
  })()`);
  assert.equal(layout.horizontalOverflow, false, `${name}: horizontal overflow`);
  assert.equal(layout.inViewport, true, `${name}: sheet outside viewport`);
  assert.equal(layout.fullWidth, true, `${name}: mobile sheet should fill the width`);
  assert.ok(layout.controls.every(c => c.height >= 43), `${name}: undersized touch control`);
  const shot = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(resolve(out, `${name}.png`), Buffer.from(shot.data, "base64"));
  report.push({ name, ...layout });
}
try {
  await cdp("Runtime.enable");
  await evaluate(`(() => {
    document.querySelector('.steam-sheet[open]')?.close();
    window.__steamUX={status:${JSON.stringify(idle)},commands:[],failNext:false,polls:0};
    const run=async r=>{
      const m=window.__steamUX;
      if(r.action==='status')m.polls++;
      if(r.action==='status' && m.delayPoll){m.delayPoll=false;const snapshot=structuredClone(m.status);await new Promise(ok=>m.releasePoll=ok);return snapshot;}
      if(r.action!=='status') m.commands.push({action:r.action,choice:r.choice,cloud:r.cloud,offline:r.offline,useGuardCode:r.useGuardCode,validCode:/^[A-Z0-9]{5,8}$/.test(r.code||'')});
      if(m.failNext && r.action!=='status'){m.failNext=false;throw new Error('Steam 连接中断，请检查网络后重试。');}
      if(r.action==='login')m.status={...m.status,busy:true,stage:'connecting',operation:'login',job:'mock-job'};
      if(r.action==='cancel')m.status={...m.status,busy:false,stage:'cancelled'};
      if(r.action==='logout')m.status={...m.status,account:'',steamId:'',game:'',stage:'signed-out',operation:'logout'};
      if(r.action==='settings')m.status={...m.status,...('cloud'in r?{cloud:r.cloud}:{}),...('offline'in r?{offline:r.offline}:{})};
      if(['sync','resolve','download','probe'].includes(r.action))m.status={...m.status,busy:true,stage:'connecting',operation:r.action};
      return structuredClone(m.status);
    };
    // Tauri's invoke/ipc properties are sealed. Intercept BOTH transports instead,
    // and assert polling reached the mock before any form can be submitted.
    const native=window.ipc;
    window.ipc={postMessage(data){
      const message=JSON.parse(data);
      if(message.cmd!=='android_steam')return native.postMessage(data);
      run(message.payload.request).then(value=>window.__TAURI_INTERNALS__.runCallback(message.callback,value),
        error=>window.__TAURI_INTERNALS__.runCallback(message.error,String(error)));
    }};
    const nativeFetch=window.fetch;
    window.fetch=async (input,options)=>{
      const url=String(input instanceof Request?input.url:input);
      if(!/^https?:\\/\\/ipc.localhost\\/android_steam(?:[?#]|$)|^ipc:\\/\\/localhost\\/android_steam(?:[?#]|$)/.test(url))return nativeFetch(input,options);
      try {return new Response(JSON.stringify(await run(JSON.parse(options.body).request)),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}});}
      catch(e){return new Response(JSON.stringify(String(e)),{headers:{'Content-Type':'application/json','Tauri-Response':'error'}});}
    };
  })()`);
  await wait("window.__steamUX.polls > 0"); await sleep(150);
  await check(`!document.querySelector('.steam-sheet[open]') && !document.querySelector('.steam-sheet input')`, "credentials not mounted on Home");
  await capture("01-home");
  await click(".steam-entry"); await screen("login"); await capture("02-login");
  await check(`document.activeElement.tagName==='H2'`, "opening should not summon keyboard");
  androidBack(); await wait(`!document.querySelector('.steam-sheet[open]')`);
  await click(".steam-entry"); await screen("login");
  await fill('.steam-sheet input[name="username"]', "ux_test_account");
  await fill('.steam-sheet input[name="password"]', "dummy_not_a_real_password");
  await click('.steam-sheet button[aria-label="显示密码"]');
  await check(`document.querySelector('.steam-sheet input[name="password"]').type==='text'`, "show password");
  await click('.steam-sheet button[aria-label="关闭 Steam 面板"]');
  await check(`document.activeElement.classList.contains('steam-entry')`, "close restores focus to entry");
  await click(".steam-entry"); await screen("login");
  await check(`document.querySelector('.steam-sheet input[name="password"]').value===''`, "closing clears password");
  await fill('.steam-sheet input[name="password"]', "dummy_not_a_real_password");
  await evaluate("window.__steamUX.delayPoll=true");
  await wait("typeof window.__steamUX.releasePoll==='function'");
  await button("登录 Steam"); await screen("progress");
  await evaluate("window.__steamUX.releasePoll()"); await sleep(200);
  await screen("progress"); // A stale idle poll must not replace the new login job.
  await check(`!document.querySelector('.steam-sheet input[name="password"]')`, "password form removed while authenticating");
  await setStatus({ ...idle, busy: true, operation: "login", stage: "guard-confirm", job: "mock-job" });
  await screen("approval"); await capture("03-approval");
  await button("改用验证码登录"); await screen("login");
  await check(`document.querySelector('.steam-check input').checked`, "code fallback retained");
  await fill('.steam-sheet input[name="password"]', "dummy_not_a_real_password");
  await button("登录 Steam"); await screen("progress");
  await setStatus({ ...idle, busy: true, operation: "login", stage: "guard-device", job: "mock-job", revision: "1" });
  await screen("code"); await capture("04-guard");
  await fill(".steam-code", "a1b2c"); await sleep(50);
  await check(`document.querySelector('.steam-code').value==='A1B2C'`, "code normalized");
  await button("验证并继续");
  await check(`document.querySelector('.steam-code').disabled`, "prevent duplicate guard submission");
  for (const revision of ["2", "3"]) {
    await setStatus({ ...idle, busy: true, stage: "guard-device", job: "mock-job", revision, message: "验证码不正确，请重新输入。" });
    await check(`!document.querySelector('.steam-code').disabled`, "repeated incorrect codes remain retryable");
    await fill(".steam-code", "C3D4E"); await button("验证并继续");
  }
  await setStatus({ ...idle, busy: true, stage: "guard-email", revision: "4" });
  await screen("code"); await capture("05-email");
  await setStatus(signedIn); await screen("overview"); await capture("06-library");
  await button("下载游戏"); await screen("download"); await capture("07-download-confirm");
  androidBack(); await screen("overview"); // Back from confirmation returns a step, not to Android.
  await button("下载游戏"); await screen("download");
  await button("开始下载"); await screen("progress");
  await setStatus({ ...signedIn, busy: true, operation: "download", stage: "downloading", done: 400, total: 1000 });
  await capture("08-downloading"); await button("收起面板");
  await check(`window.__steamUX.status.busy && !document.querySelector('.steam-sheet[open]')`, "closing doesn't cancel download");
  await click(".steam-entry"); await screen("progress");
  await button("取消当前操作"); await screen("overview");
  const game = "/storage/emulated/0/Android/data/cc.microblock.celemod/files/games/Steam-76561198000000000";
  await setStatus({ ...signedIn, game, pending: true, operation: "sync", stage: "error", message: "Steam 操作失败（HttpRequestException）" });
  await screen("overview"); await capture("09-sync-error");
  await evaluate("window.__steamUX.failNext=true");
  await button("重试同步"); await screen("overview");
  await check(`document.querySelector('.steam-error').textContent.includes('暂时无法连接 Steam')`, "command rejection gives actionable error");
  await button("重试同步"); await screen("progress");
  const conflict = { ...signedIn, game, pending: true, stage: "conflict", conflicts: [{ name: "Saves/0.celeste", local: "hash-a", remote: "hash-b" }, { name: "Saves/1.celeste", local: null, remote: "hash-c" }] };
  await setStatus(conflict); await screen("conflict"); await capture("10-conflict");
  await click(".steam-choice"); await screen("local"); await capture("11-conflict-confirm");
  await button("确认使用手机版本"); await screen("progress");
  await check(`window.__steamUX.commands.at(-1).choice==='local'`, "conflict choice correctly forwarded");
  await setStatus({ ...signedIn, game }); await screen("overview");
  await button("账号与云存档设置"); await screen("settings"); await capture("12-settings");
  await click('.steam-setting input'); await screen("disable-cloud");
  await check(`window.__steamUX.status.cloud`, "disabling cloud needs explicit confirmation");
  await button("关闭自动同步"); await screen("settings");
  await check(`!window.__steamUX.status.cloud`, "cloud setting saved");
  await click('.steam-setting:nth-of-type(2) input');
  await check(`window.__steamUX.status.offline`, "offline setting saved");
  await button("退出账号"); await screen("logout"); await capture("13-logout-confirm");
  await button("退出并保留本地数据"); await screen("login");
  await check(`!document.querySelector('.steam-error')`, "logout is not an error");
  for (const theme of ["vanilla", "fluent", "material-you"]) {
    await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await capture(`14-login-${theme}`);
  }
  // Stress narrow/landscape dimensions without changing the device's display setting.
  for (const [width,height] of [[320,640],[780,360]]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    await sleep(250); await capture(`15-login-${width}x${height}`);
  }
  await cdp("Emulation.clearDeviceMetricsOverride");
  assert.deepEqual(errors, [], "No WebView runtime exceptions");
  writeFileSync(resolve(out, "report.json"), JSON.stringify({ report, errors, commands: await evaluate("window.__steamUX.commands") }, null, 2));
  console.log(`PASS: ${report.length} Android Steam UX screenshots; login, Guard retries, download, conflict, settings, cleanup, themes, responsive layout.`);
} finally {
  try { await cdp("Emulation.clearDeviceMetricsOverride"); await cdp("Page.reload", { ignoreCache: true }); }
  finally { ws.close(); }
}
