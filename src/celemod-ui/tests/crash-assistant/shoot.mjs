// Headless screenshot + geometry check for the crash assistant fixture.
// Usage: node tests/crash-assistant/shoot.mjs <outDir> [width] [height] [url]
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2] ?? ".";
const width = Number(process.argv[3] ?? 1100);
const height = Number(process.argv[4] ?? 900);
const url = process.argv[5] ?? "http://127.0.0.1:1429/tests/crash-assistant/";

const candidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "ms-playwright")
    : undefined,
].filter(Boolean);

const chromium = (() => {
  for (const candidate of candidates) {
    if (candidate.endsWith(".exe") && existsSync(candidate)) return candidate;
    if (!candidate.endsWith(".exe") && existsSync(candidate)) {
      const found = readdirRecursive(candidate).find((item) =>
        item.endsWith("chrome.exe"),
      );
      if (found) return found;
    }
  }
  return null;
})();

function readdirRecursive(directory) {
  const results = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...readdirRecursive(full));
    else results.push(full);
  }
  return results;
}

if (!chromium)
  throw new Error(
    "No Chromium binary found. Set CHROME_PATH to a Chrome/Edge executable.",
  );

mkdirSync(outDir, { recursive: true });
const base = [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--window-size=${width},${height}`,
  "--virtual-time-budget=10000",
];

const shot = join(outDir, `crash-assistant-${width}x${height}.png`);
const shotRun = spawnSync(chromium, [...base, `--screenshot=${shot}`, url], {
  encoding: "utf8",
});
if (!existsSync(shot)) throw new Error("Screenshot failed: " + shotRun.stderr);

const domRun = spawnSync(chromium, [...base, "--dump-dom", url], {
  encoding: "utf8",
});
const dom = domRun.stdout ?? "";
writeFileSync(join(outDir, `crash-assistant-${width}x${height}.html`), dom);

const match = dom.match(/data-crash-metrics="([^"]*)"/);
if (!match) throw new Error("The crash assistant popup never rendered");

const decode = (value) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
const metrics = JSON.parse(decode(match[1]));
console.log(JSON.stringify(metrics, null, 2));
console.log("screenshot:", shot);

const viewportHeight = metrics.viewport.height;
const states = { top: metrics.topState, bottom: metrics.bottomState };
const inside = (box) => box && box.top >= 0 && box.bottom <= viewportHeight;
// A very short window cannot show every row at once; those rows only need to be
// reachable by scrolling, which the popup allows in that case.
const visible = (box) => box && box.top < viewportHeight && box.bottom > 0;
const inAnyState = (key) =>
  Object.values(states).some((state) => visible(state[key]));

const problems = [];
if (metrics.containerTransform !== "none")
  problems.push(`popup container transform is ${metrics.containerTransform}`);

// The popup opens at its top edge and scrolls when the window is too short.
for (const key of ["heading", "close", "summary"])
  if (!inside(states.top[key]))
    problems.push(
      `${key} is not visible when the popup opens: ${JSON.stringify(states.top[key])} of ${viewportHeight}`,
    );
for (const key of ["actions", "ignore"])
  if (!inside(states.bottom[key]))
    problems.push(
      `${key} is unreachable even at the end of the scroll range: ${JSON.stringify(states.bottom[key])} of ${viewportHeight}`,
    );
for (const key of ["grid", "advice", "report"])
  if (!inAnyState(key)) problems.push(`${key} is never inside the viewport`);

console.log(
  `scrollable: ${metrics.popupScrollable} | title: ${metrics.title} | trace: ${JSON.stringify(metrics.trace)}`,
);

if (problems.length > 0) {
  console.error("FAIL\n- " + problems.join("\n- "));
  process.exitCode = 1;
} else {
  console.log(
    "OK: every crash assistant control is reachable inside the viewport",
  );
}
