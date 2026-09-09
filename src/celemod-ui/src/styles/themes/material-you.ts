const RIPPLE_HOST = "button, [role='button'], .md-ripple-host";
const MIN_PRESS_MS = 180;
const FADE_MS = 160;

interface Ripple {
  host: HTMLElement;
  layer: HTMLSpanElement;
  started: number;
  released: boolean;
  timer?: number;
  pointerId?: number;
  key?: string;
  x?: number;
  y?: number;
}

/** Delegated, theme-scoped feedback. Never captures pointers or synthesizes clicks. */
export const installMaterialYouInteractions = () => {
  if (typeof window === "undefined" || document.documentElement.dataset.materialYouHooks === "installed") return () => {};
  const root = document.documentElement;
  root.dataset.materialYouHooks = "installed";
  const ripples = new Set<Ripple>();
  const pointers = new Map<number, Ripple>();
  const keys = new Map<string, Ripple>();
  const positioned = new Set<HTMLElement>();
  const listeners = new AbortController();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const isMaterialYou = () => root.dataset.theme === "material-you";

  const getHost = (event: Event) => {
    const element = event.composedPath().find((node): node is Element => node instanceof Element);
    const host = element?.closest(RIPPLE_HOST);
    // SVG role=button controls cannot contain an HTML state layer.
    if (!(host instanceof HTMLElement) || host.closest(":disabled, [aria-disabled='true'], [inert]")) return;
    // An input/link nested in an explicit host is its own interaction, not a host press.
    if (element?.closest("input, textarea, select, a[href], [contenteditable='true']")) return;
    return host;
  };

  const untrack = (ripple: Ripple) => {
    if (pointers.get(ripple.pointerId) === ripple) pointers.delete(ripple.pointerId);
    if (keys.get(ripple.key) === ripple) keys.delete(ripple.key);
  };
  const remove = (ripple: Ripple) => {
    window.clearTimeout(ripple.timer);
    untrack(ripple);
    ripple.layer.remove();
    ripples.delete(ripple);
    if (![...ripples].some((other) => other.host === ripple.host)) {
      ripple.host.classList.remove("md-ripple-active");
      if (positioned.delete(ripple.host)) ripple.host.classList.remove("md-ripple-positioned");
    }
  };
  const clear = () => [...ripples].forEach(remove);

  const release = (ripple: Ripple, cancelled = false) => {
    if (ripple.released) return;
    ripple.released = true;
    untrack(ripple);
    // Quick taps still show an expansion; long presses fade as soon as released.
    const delay = cancelled || reducedMotion.matches ? 0 : Math.max(0, MIN_PRESS_MS - (performance.now() - ripple.started));
    ripple.timer = window.setTimeout(() => {
      ripple.layer.dataset.releasing = "";
      // Fallback also handles detached nodes and styles disabling animations.
      ripple.timer = window.setTimeout(() => remove(ripple), reducedMotion.matches ? 0 : FADE_MS + 50);
    }, delay);
  };

  const start = (host: HTMLElement, point?: { x: number; y: number }) => {
    const existing = [...ripples].filter((ripple) => ripple.host === host);
    // Keep the previous fade on double taps, without stacking unlimited state layers.
    if (existing.some((ripple) => !ripple.released)) return;
    existing.slice(0, Math.max(0, existing.length - 1)).forEach(remove);
    if (getComputedStyle(host).position === "static") {
      host.classList.add("md-ripple-positioned");
      positioned.add(host);
    }
    const layer = document.createElement("span");
    layer.className = "md-ripple";
    layer.setAttribute("aria-hidden", "true");
    const wave = document.createElement("span");
    wave.className = "md-ripple-wave";
    layer.appendChild(wave);
    host.appendChild(layer);
    host.classList.add("md-ripple-active");
    const ripple: Ripple = { host, layer, started: performance.now(), released: false };
    ripples.add(ripple);
    // Measure the actual clipping surface, including rail pills and CSS transforms.
    const rect = layer.getBoundingClientRect();
    const width = layer.clientWidth, height = layer.clientHeight;
    if (!rect.width || !rect.height || !width || !height) {
      remove(ripple);
      return;
    }
    const x = point ? Math.max(0, Math.min(width, (point.x - rect.left) * width / rect.width)) : width / 2;
    const y = point ? Math.max(0, Math.min(height, (point.y - rect.top) * height / rect.height)) : height / 2;
    const diameter = 2 * Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
    wave.style.width = wave.style.height = `${diameter}px`;
    wave.style.left = `${x - diameter / 2}px`;
    wave.style.top = `${y - diameter / 2}px`;
    wave.style.setProperty("--md-ripple-start-scale", `${Math.min(0.3, 20 / diameter)}`);
    return ripple;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!isMaterialYou() || event.button !== 0 || !event.isPrimary) return;
    const host = getHost(event);
    if (!host) return;
    const previous = pointers.get(event.pointerId);
    if (previous) release(previous, true);
    const ripple = start(host, { x: event.clientX, y: event.clientY });
    if (!ripple) return;
    ripple.pointerId = event.pointerId;
    ripple.x = event.clientX;
    ripple.y = event.clientY;
    pointers.set(event.pointerId, ripple);
  };
  const onPointerEnd = (event: PointerEvent) => {
    const ripple = pointers.get(event.pointerId);
    if (ripple) release(ripple, event.type !== "pointerup");
  };
  const onPointerMove = (event: PointerEvent) => {
    const ripple = pointers.get(event.pointerId);
    if (!ripple) return;
    const rect = ripple.host.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    const scrolling = event.pointerType === "touch" && Math.hypot(event.clientX - ripple.x, event.clientY - ripple.y) > 10;
    if (outside || scrolling) release(ripple, true);
  };
  const onPointerOut = (event: PointerEvent) => {
    if (!event.relatedTarget) onPointerEnd(event);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isMaterialYou() || event.repeat || event.altKey || event.ctrlKey || event.metaKey || (event.key !== " " && event.key !== "Enter")) return;
    const host = getHost(event);
    if (!host || keys.has(event.key)) return;
    const ripple = start(host);
    if (ripple) {
      ripple.key = event.key;
      keys.set(event.key, ripple);
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    const ripple = keys.get(event.key);
    if (ripple) release(ripple);
  };
  const onFocusOut = (event: FocusEvent) => {
    for (const ripple of keys.values()) {
      if (event.target === ripple.host) release(ripple, true);
    }
  };
  const onAnimationEnd = (event: AnimationEvent) => {
    // Expansion finishing must not remove a held ripple. Delegate this too, so
    // the installation never retains per-ripple listeners after repeated clicks.
    if (event.animationName !== "md-ripple-exit") return;
    for (const ripple of ripples) if (event.target === ripple.layer) remove(ripple);
  };
  const options = { capture: true, passive: true, signal: listeners.signal };
  document.addEventListener("pointerdown", onPointerDown, options);
  window.addEventListener("pointerup", onPointerEnd, options);
  window.addEventListener("pointercancel", onPointerEnd, options);
  document.addEventListener("lostpointercapture", onPointerEnd, options);
  document.addEventListener("pointermove", onPointerMove, options);
  document.addEventListener("pointerout", onPointerOut, options);
  document.addEventListener("keydown", onKeyDown, options);
  window.addEventListener("keyup", onKeyUp, options);
  document.addEventListener("focusout", onFocusOut, options);
  document.addEventListener("animationend", onAnimationEnd, options);
  window.addEventListener("blur", clear, options);
  document.addEventListener("visibilitychange", () => { if (document.hidden) clear(); }, options);
  // Observe removals/disabled state as well: route changes can unmount a held control.
  const syncTonalSurfaces = () => document.querySelectorAll<HTMLElement>(".md-tonal-surface")
    .forEach((node) => node.classList.toggle("md-tonal-active", isMaterialYou()));
  const observer = new MutationObserver((mutations) => {
    if (!isMaterialYou()) clear();
    else for (const ripple of ripples) {
      if (!ripple.host.isConnected || !ripple.layer.isConnected || ripple.host.closest(":disabled, [aria-disabled='true'], [inert]")) remove(ripple);
    }
    // Do not scan the entire app for tonal surfaces on every progress/text update.
    if (mutations.some((mutation) => mutation.target === root && mutation.attributeName === "data-theme")) syncTonalSurfaces();
  });
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "disabled", "aria-disabled", "inert"], childList: true, subtree: true });
  syncTonalSurfaces();
  return () => {
    observer.disconnect();
    listeners.abort();
    clear();
    document.querySelectorAll(".md-tonal-active").forEach((node) => node.classList.remove("md-tonal-active"));
    delete root.dataset.materialYouHooks;
  };
};

export const materialYouTonal = (tone: "primary" | "secondary" | "tertiary" | "surface" = "surface") => ({
  "data-md-tonal": tone,
  className: "md-tonal-surface",
});
