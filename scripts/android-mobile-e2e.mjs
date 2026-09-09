// Real Android WebView UI smoke test. Run after adb forwarding its debug socket to 9223.
// No game files, accounts or downloads are modified. Screenshots/reports stay in .local.
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const out = resolve(
  ".local/mobile-e2e",
  process.env.CELEMOD_TEST_THEME || "vanilla"
);
mkdirSync(out, { recursive: true });
const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
const target = targets.find((t) => /^https?:\/\/tauri.localhost/.test(t.url));
if (!target)
  throw new Error("Open CeleMod and forward its WebView debug socket to 9223.");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, fail) => {
  socket.onopen = ok;
  socket.onerror = fail;
});
let id = 0;
const pending = new Map();
const errors = [];
socket.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === "Runtime.exceptionThrown")
    errors.push(m.params.exceptionDetails);
  const request = pending.get(m.id);
  if (!request) return;
  pending.delete(m.id);
  clearTimeout(request.timer);
  if (m.error) request.fail(new Error(JSON.stringify(m.error)));
  else request.ok(m.result);
};
const cdp = (method, params = {}) =>
  new Promise((ok, fail) => {
    const next = ++id;
    const timer = setTimeout(() => {
      pending.delete(next);
      fail(new Error(`Timeout: ${method}`));
    }, 30000);
    pending.set(next, { ok, fail, timer });
    socket.send(JSON.stringify({ id: next, method, params }));
  });
const evaluate = async (expression) => {
  const result = await cdp("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function wait(expression) {
  for (let i = 0; i < 80; i++) {
    if (await evaluate(expression)) return;
    await sleep(150);
  }
  throw new Error(`UI did not appear: ${expression}`);
}
async function tap(selector) {
  const focus = execFileSync(
    resolve(".local/android-sdk/platform-tools/adb.exe"),
    ["shell", "dumpsys", "window"],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
  );
  if (
    !/mCurrentFocus=.*cc\.microblock\.celemod\/\.?(?:cc\.microblock\.celemod\.)?MainActivity/.test(
      focus
    )
  ) {
    throw new Error(
      "Manager is not foreground. Stop to avoid tapping a game or another app."
    );
  }
  await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
  await evaluate(
    `document.querySelector(${JSON.stringify(
      selector
    )}).scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`
  );
  await sleep(100);
  const p = await evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(
      selector
    )}),r=e.getBoundingClientRect();return {x:Math.round((r.x+r.width/2)*devicePixelRatio),y:Math.round((r.y+r.height/2)*devicePixelRatio)}})()`
  );
  execFileSync(resolve(".local/android-sdk/platform-tools/adb.exe"), [
    "shell",
    "input",
    "tap",
    String(p.x),
    String(p.y),
  ]);
  await sleep(350);
}
const screenshot = (name) => {
  const adb = resolve(".local/android-sdk/platform-tools/adb.exe");
  writeFileSync(
    resolve(out, `${name}.png`),
    execFileSync(adb, ["exec-out", "screencap", "-p"], {
      maxBuffer: 20 * 1024 * 1024,
    })
  );
};
const layout = () =>
  evaluate(`(() => {
  const page=document.querySelector('.page[aria-hidden="false"]');
  const nav=document.querySelector('.mobile-navigation').getBoundingClientRect();
  const outside=[...page.querySelectorAll('*')].filter(e=>{
    const r=e.getBoundingClientRect();
    if(!r.width||!r.height||r.bottom<0||r.top>nav.top) return false;
    if(r.left>=-1&&r.right<=document.documentElement.clientWidth+1) return false;
    for(let p=e.parentElement;p&&p!==page;p=p.parentElement){ if(['auto','scroll','hidden'].includes(getComputedStyle(p).overflowX))return false; }
    return true;
  }).map(e=>({class:e.className,text:e.textContent.slice(0,60),rect:e.getBoundingClientRect().toJSON()}));
  return {page:page.className,width:innerWidth,height:innerHeight,scrollWidth:page.scrollWidth,clientWidth:page.clientWidth,navTop:nav.top,outside};
})()`);
const report = [];
async function capture(name) {
  await sleep(400);
  report.push({ name, ...(await layout()) });
  screenshot(name);
  console.log(name, JSON.stringify(report.at(-1)));
}
async function go(page) {
  const direct = { Home: 1, Search: 2, Manage: 3, Downloads: 4 };
  if (direct[page])
    await tap(`.mobile-navigation > button:nth-child(${direct[page]})`);
  else {
    await tap(".mobile-navigation > button:last-child");
    const index = await evaluate(
      `[...document.querySelectorAll('.mobile-more-grid button')].findIndex(e=>e.textContent.trim()===${JSON.stringify(
        {
          Everest: "Everest",
          KeyBindings: "按键",
          RecommendMods: "推荐模组",
          Multiplayer: "联机相关",
          Loenn: "Loenn",
          Settings: "设置",
        }[page]
      )})`
    );
    if (index < 0) {
      await tap(".mobile-more-sheet header button");
      return false;
    }
    await tap(`.mobile-more-grid > button:nth-child(${index + 1})`);
  }
  await wait(`!!document.querySelector('.page-${page}[aria-hidden="false"]')`);
  await wait(`!document.querySelector('.mobile-more-sheet').open`);
  return true;
}
const originalTheme = await evaluate("document.documentElement.dataset.theme");
try {
  await cdp("Runtime.enable");
  if (
    !(await evaluate(
      'innerHeight > innerWidth && document.documentElement.hasAttribute("data-mobile-layout")'
    ))
  )
    throw new Error("Expected portrait mobile layout");
  if (process.env.CELEMOD_TEST_THEME)
    await evaluate(
      "document.documentElement.dataset.theme=" +
        JSON.stringify(process.env.CELEMOD_TEST_THEME)
    );
  for (const page of process.env.CELEMOD_TEST_PAGES?.split(",") ?? [
    "Home",
    "Search",
    "Manage",
    "Downloads",
    "Everest",
    "KeyBindings",
    "RecommendMods",
    "Multiplayer",
    "Loenn",
    "Settings",
  ]) {
    if (!(await go(page))) continue;
    await sleep(page === "Search" || page === "Everest" ? 3500 : 1000);
    await capture(page);
    if (page === "Search") {
      await tap(".filter-toggle");
      await capture("Search-filters");
      await tap(".filter-toggle");
    }
    if (page === "KeyBindings" && process.env.CELEMOD_TEST_DETAILS) {
      await tap(".mobile-binding-overview-toggle");
      await wait("document.querySelector('.mobile-binding-overview-toggle').getAttribute('aria-expanded') === 'true'");
      await capture("KeyBindings-overview");
      await tap(".mobile-binding-overview-toggle");
      await tap(".input-mode-switch button:last-child");
      await capture("KeyBindings-controller");
      await tap(".input-mode-switch button:first-child");
    }
    if (page === "RecommendMods" && process.env.CELEMOD_TEST_DETAILS) {
      await tap(".recommend-tabs > button:nth-child(2)");
      await capture("RecommendMaps");
      await tap(".recommend-tabs > button:nth-child(3)");
      await capture("RecommendSkins");
    }
    if (page === "Settings" && process.env.CELEMOD_TEST_DETAILS) {
      await evaluate("document.querySelector('.page-Settings').scrollTop = document.querySelector('.page-Settings').scrollHeight");
      await capture("Settings-bottom");
    }
  }
  if (process.env.CELEMOD_TEST_DETAILS) {
    await go("Home");
    const count = await evaluate("document.querySelectorAll('.home-shortcut').length");
    for (let index = 0; index < count; index++) {
      await go("Home");
      await tap(`.home-shortcut:nth-child(${index + 1})`);
      await wait("!document.querySelector('.page-Home[aria-hidden=\"false\"]')");
      console.log("Shortcut", index + 1, await evaluate("document.querySelector('.page[aria-hidden=\"false\"]').className"));
    }
  }
  await go("Home");
  await tap(".mobile-navigation > button:last-child");
  screenshot("More");
  await tap(".mobile-more-sheet header button");
  console.log("runtimeExceptions", JSON.stringify(errors));
  writeFileSync(
    resolve(out, "report.json"),
    JSON.stringify({ report, errors }, null, 2)
  );
  if (
    report.some((r) => r.scrollWidth > r.clientWidth + 1 || r.outside.length) ||
    errors.length
  )
    process.exitCode = 1;
} finally {
  await evaluate(
    "document.documentElement.dataset.theme=" + JSON.stringify(originalTheme)
  );
  socket.close();
}
