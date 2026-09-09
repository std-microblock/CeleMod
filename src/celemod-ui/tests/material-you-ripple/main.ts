import { installMaterialYouInteractions } from "../../src/styles/themes/material-you";
import "../../src/index.scss";
import "../../src/components/SteamAccount.scss";

document.querySelector("#root")!.innerHTML = `
  <style>
    #root { box-sizing: border-box; padding: 32px; overflow: auto; }
    .samples { display: flex; align-items: center; flex-wrap: wrap; gap: 24px; margin: 24px 0; }
    #root .sidebar { position: static; width: 72px; height: auto; padding: 8px 0; }
    #plain { display: flex; gap: 12px; align-items: center; width: 220px; height: 52px; }
    #badge { position: absolute; right: -4px; top: -4px; }
    #role { padding: 14px 24px; border-radius: 12px; background: #4f378b; cursor: pointer; }
    #root #output { white-space: pre-wrap; font: 13px/1.6 monospace; }
    .tools { display: flex; gap: 12px; flex-wrap: wrap; }
  </style>
  <h1>Material You · Ripple</h1>
  <p>Press and hold, tap quickly, drag away, or use Space / Enter.</p>
  <section class="samples">
    <button id="plain"><svg width="20" height="20" viewBox="0 0 20 20"><path d="M4 3L17 10L4 17Z" fill="currentColor" /></svg><span id="label">Launch game</span><small id="badge">3</small></button>
    <button id="primary" class="primary">Primary action</button>
    <div class="sidebar"><button id="rail" class="navBtn selected"><svg class="icon" viewBox="0 0 20 20"><path d="M4 3L17 10L4 17Z" fill="currentColor" /></svg><span class="title">Home</span></button></div>
    <div id="role" role="button" tabindex="0">Custom host</div>
    <button id="disabled" disabled>Disabled</button>
    <div aria-disabled="true"><button id="aria-disabled">Disabled group</button></div>
    <div id="editable" class="md-ripple-host"><input aria-label="Nested input" /></div>
    <svg width="24" height="24"><path id="svg-role" role="button" tabindex="0" d="M2 2H22V22H2Z" fill="currentColor" /></svg>
  </section>
  <div class="tools"><button id="run">Run regression checks</button><button id="preview">Preview held ripples</button><button id="release">Release preview</button></div>
  <p id="pointer-result">Real input: waiting</p>
  <pre id="output" role="status">Ready</pre>
`;

let dispose = installMaterialYouInteractions();
const $ = (id: string) => document.getElementById(id)!;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const layers = (host = $("plain")) => host.querySelectorAll(":scope > .md-ripple");
function pointer(type: string, host: Element = $("plain"), overrides: PointerEventInit = {}) {
  const rect = host.getBoundingClientRect();
  host.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0,
    clientX: rect.left + 8, clientY: rect.top + 8, ...overrides }));
}
function key(type: string, value: string, host = $("plain"), repeat = false) {
  host.dispatchEvent(new KeyboardEvent(type, { key: value, repeat, bubbles: true }));
}
function reset() { dispose(); document.documentElement.dataset.theme = "material-you"; dispose = installMaterialYouInteractions(); }

// Real browser input is separate from the deterministic lifecycle checks below.
document.addEventListener("pointerdown", event => {
  if (!(event.target instanceof Element)) return;
  const host = event.target.closest(".samples button, #role");
  if (!host) return;
  const layer = host.querySelector(".md-ripple");
  if (!layer) return;
  const style = getComputedStyle(layer);
  $("pointer-result").textContent = `Pointer (${event.isTrusted ? "trusted" : "synthetic"}): ${host.id}; position=${style.position}; display=${style.display}; flex=${style.flexGrow}; clipped=${style.overflow}`;
});
document.addEventListener("keydown", event => {
  if ((event.key === " " || event.key === "Enter") && event.target instanceof HTMLElement && event.target.closest(".samples")) {
    $("pointer-result").textContent = `Keyboard (${event.isTrusted ? "trusted" : "synthetic"}): ${event.key === " " ? "Space" : "Enter"}; layers=${layers(event.target).length}`;
  }
});
$("preview").onclick = () => {
  reset();
  for (const [index, id] of ["plain", "primary", "rail", "role"].entries()) pointer("pointerdown", $(id), { pointerId: index + 20 });
};
$("release").onclick = () => {
  for (let i = 0; i < 4; i++) pointer("pointerup", document.body, { pointerId: i + 20 });
};

$("run").onclick = async () => {
  $("run").setAttribute("disabled", "");
  const results: string[] = [];
  const check = async (name: string, test: () => void | Promise<void>) => {
    reset(); await test(); results.push(`PASS ${name}`); $("output").textContent = results.join("\n");
  };
  try {
    await check("held press survives expansion and old 650ms timeout", async () => {
      pointer("pointerdown"); await wait(750);
      assert(layers().length === 1, "held layer removed");
      assert(!layers()[0].hasAttribute("data-releasing"), "held layer is fading");
      assert(getComputedStyle(layers()[0].firstElementChild!).opacity === "0.1", "held state invisible");
      pointer("pointerup", document.body); await wait(260);
      assert(layers().length === 0 && !$("plain").classList.contains("md-ripple-active"), "outside release stuck");
    });
    await check("quick taps have a minimum visible duration, then clean up", async () => {
      pointer("pointerdown"); pointer("pointerup"); await wait(60);
      assert(layers().length === 1 && !layers()[0].hasAttribute("data-releasing"), "tap disappeared too early");
      await wait(450); assert(layers().length === 0, "tap leaked");
    });
    await check("SVG child targets + off-center geometry + no flex/badge changes", () => {
      const before = $("label").getBoundingClientRect();
      pointer("pointerdown", $("plain").querySelector("path")!);
      const layer = layers()[0] as HTMLElement, wave = layer.firstElementChild as HTMLElement;
      const style = getComputedStyle(layer), after = $("label").getBoundingClientRect();
      assert(style.position === "absolute" && style.display === "block" && style.flexGrow === "0" && style.overflow === "hidden", "layer participates in layout");
      assert(before.x === after.x && before.width === after.width && getComputedStyle($("badge")).position === "absolute", "content repositioned");
      assert(getComputedStyle($("plain")).contain === "none" && getComputedStyle($("plain")).overflow === "visible", "host still clips all paint");
      const x = parseFloat(wave.style.left) + parseFloat(wave.style.width) / 2;
      assert(x < layer.clientWidth / 2, "origin was centered instead of at pointer");
      assert(layer.getAttribute("aria-hidden") === "true", "decorative layer exposed");
    });
    await check("rail uses the same pill bounds as its indicator, not the label", () => {
      pointer("pointerdown", $("rail").querySelector(".title")!);
      const layer = layers($("rail"))[0] as HTMLElement;
      const indicator = getComputedStyle($("rail"), "::before"), style = getComputedStyle(layer);
      assert(style.top === indicator.top && style.left === indicator.left && style.height === indicator.height && style.width === indicator.width, "rail bounds differ");
      assert(layer.getBoundingClientRect().bottom < $("rail").querySelector(".title")!.getBoundingClientRect().bottom, "ripple covers label");
    });
    await check("role buttons get temporary positioning without permanent inline styles", async () => {
      pointer("pointerdown", $("role"));
      assert(layers($("role")).length === 1 && getComputedStyle($("role")).position === "relative", "custom host has no positioned layer");
      pointer("pointerup"); await wait(450);
      assert(!$("role").classList.contains("md-ripple-positioned") && !$("role").getAttribute("style"), "custom position leaked");
    });
    await check("right/middle buttons, secondary touches, disabled, nested input, SVG hosts ignored", () => {
      pointer("pointerdown", $("plain"), { button: 2 }); pointer("pointerdown", $("plain"), { button: 1 });
      pointer("pointerdown", $("plain"), { isPrimary: false });
      for (const id of ["disabled", "aria-disabled", "svg-role"]) pointer("pointerdown", $(id));
      pointer("pointerdown", $("editable").querySelector("input")!);
      assert(document.querySelectorAll(".md-ripple").length === 0, "invalid target got ripple");
    });
    await check("Space/Enter center feedback, ignore repeats, release by key not event target", async () => {
      for (const value of [" ", "Enter"]) {
        key("keydown", value); key("keydown", value, $("plain"), true);
        assert(layers().length === 1, "repeat duplicated keyboard ripple");
        const layer = layers()[0] as HTMLElement, wave = layer.firstElementChild as HTMLElement;
        assert(Math.abs(parseFloat(wave.style.left) + parseFloat(wave.style.width) / 2 - layer.clientWidth / 2) < .1, "keyboard origin not centered");
        key("keyup", value, document.body); await wait(450); assert(layers().length === 0, "key release stuck");
      }
    });
    await check("cancel, lost capture, pointer leaving viewport, drag out and touch scroll", async () => {
      for (const end of ["pointercancel", "lostpointercapture", "pointerout", "drag", "scroll"]) {
        pointer("pointerdown");
        if (end === "drag") pointer("pointermove", $("plain"), { clientX: -100 });
        else if (end === "scroll") pointer("pointermove", $("plain"), { pointerType: "touch", clientX: $("plain").getBoundingClientRect().left + 30 });
        else pointer(end);
        await wait(260); assert(layers().length === 0, `${end} stuck`);
      }
    });
    await check("rapid taps keep at most two layers; old cleanup cannot clear new press", async () => {
      for (let i = 0; i < 8; i++) { pointer("pointerdown"); pointer("pointerup"); }
      pointer("pointerdown"); assert(layers().length <= 2, "unbounded layers");
      await wait(450); assert(layers().length === 1 && $("plain").classList.contains("md-ripple-active"), "old timer cleared new press");
    });
    await check("focus loss, window blur, disabling and unmounting clean up", async () => {
      key("keydown", " "); $("plain").dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await wait(260); assert(layers().length === 0, "focus loss stuck");
      pointer("pointerdown"); window.dispatchEvent(new Event("blur")); assert(layers().length === 0, "blur stuck");
      pointer("pointerdown"); $("plain").setAttribute("disabled", ""); await wait(0);
      assert(layers().length === 0, "disabled press stuck"); $("plain").removeAttribute("disabled");
      const temp = document.createElement("button"); temp.textContent = "Temporary"; $("root").appendChild(temp);
      pointer("pointerdown", temp); temp.remove(); await wait(0);
      assert(layers(temp).length === 0 && !temp.classList.contains("md-ripple-active"), "unmounted host leaked");
    });
    await check("theme switch and disposer remove layers, timers and listeners; reinstall works", async () => {
      pointer("pointerdown"); document.documentElement.dataset.theme = "vanilla"; await wait(0);
      assert(layers().length === 0, "theme switch leaked"); pointer("pointerdown"); assert(layers().length === 0, "other theme got ripple");
      document.documentElement.dataset.theme = "material-you"; pointer("pointerdown"); dispose();
      assert(layers().length === 0 && !document.documentElement.dataset.materialYouHooks, "disposer leaked");
      pointer("pointerdown"); assert(layers().length === 0, "listener survived dispose");
      dispose = installMaterialYouInteractions(); pointer("pointerdown"); assert(layers().length === 1, "reinstall failed");
    });
    await check("reduced-motion press stays visible without expansion and releases immediately", async () => {
      const original = window.matchMedia;
      dispose();
      window.matchMedia = ((query: string) => query === "(prefers-reduced-motion: reduce)" ? { matches: true } as MediaQueryList : original.call(window, query));
      const style = document.createElement("style");
      style.textContent = "html[data-theme='material-you'] .md-ripple-wave { animation-duration: .01ms !important; }";
      document.head.appendChild(style);
      try {
        dispose = installMaterialYouInteractions(); pointer("pointerdown"); await wait(60);
        const transform = layers()[0] && getComputedStyle(layers()[0].firstElementChild!).transform;
        assert(layers().length === 1 && transform === "matrix(1, 0, 0, 1, 0, 0)", `reduced-motion held feedback missing: layers=${layers().length}, transform=${transform}`);
        pointer("pointerup"); await wait(60); assert(layers().length === 0, "reduced-motion release delayed");
      } finally { window.matchMedia = original; style.remove(); }
    });
    $("output").textContent = `${results.join("\n")}\n\n${results.length} checks passed`;
    $("output").dataset.result = "passed";
  } catch (error) {
    $("output").textContent = `${results.join("\n")}\nFAIL ${error}`;
    $("output").dataset.result = "failed";
  } finally { reset(); $("run").removeAttribute("disabled"); }
};
