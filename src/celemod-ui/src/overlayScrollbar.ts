import "./overlayScrollbar.scss";

/**
 * Floating scrollbar thumb.
 *
 * Chromium cannot render an overlay scrollbar from CSS: `::-webkit-scrollbar`
 * always reserves layout space and the overlay values (`overflow: overlay`,
 * `scrollbar-width: overlay`) are gone. So native scrollbars are hidden in
 * `i2.css` and this module draws one shared thumb in `position: fixed`, which
 * costs no layout space and only appears while the pointer is inside a
 * scrollable area (or while it scrolls on touch input).
 */

const THUMB_WIDTH = 4;
const THUMB_INSET = 3;
const MIN_THUMB_HEIGHT = 28;
const HIDE_DELAY = 260;

const touchScrolling = navigator.maxTouchPoints > 0;

let thumb: HTMLDivElement | null = null;
let current: HTMLElement | null = null;
let hovered: HTMLElement | null = null;
let dragging = false;
let hideTimer = 0;
let frame = 0;
let initialized = false;

function isVerticalScroller(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement) || element === thumb) return false;
  if (element.dataset.scrollbar === "off") return false;
  const { overflowY } = getComputedStyle(element);
  if (overflowY !== "auto" && overflowY !== "scroll") return false;
  return element.scrollHeight - element.clientHeight > 1;
}

function findScroller(target: EventTarget | null): HTMLElement | null {
  let element = target instanceof Element ? target : null;
  while (element) {
    if (isVerticalScroller(element)) return element;
    element = element.parentElement;
  }
  return null;
}

function place(element: HTMLElement) {
  if (!thumb) return false;
  const rect = element.getBoundingClientRect();
  const track = element.clientHeight;
  const total = element.scrollHeight;
  const maxScroll = total - track;
  if (track <= 0 || maxScroll <= 1) return false;
  const height = Math.min(
    track,
    Math.max(MIN_THUMB_HEIGHT, (track * track) / total),
  );
  const progress = Math.min(1, Math.max(0, element.scrollTop / maxScroll));
  const top = rect.top + element.clientTop + (track - height) * progress;
  const borderRight =
    element.offsetWidth - element.clientWidth - element.clientLeft;
  const left = rect.right - borderRight - THUMB_INSET - THUMB_WIDTH;
  thumb.style.top = `${Math.round(top)}px`;
  thumb.style.left = `${Math.round(left)}px`;
  thumb.style.height = `${Math.round(height)}px`;
  return true;
}

function frameLoop() {
  frame = 0;
  if (dragging) {
    frame = requestAnimationFrame(frameLoop);
    return;
  }
  if (!current || !thumb || !thumb.classList.contains("is-visible")) return;
  if (!current.isConnected || !place(current)) {
    hide();
    return;
  }
  frame = requestAnimationFrame(frameLoop);
}

function ensureLoop() {
  if (!frame) frame = requestAnimationFrame(frameLoop);
}

function stopLoop() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

function show(element: HTMLElement) {
  if (!thumb || dragging) return;
  current = element;
  if (!place(element)) {
    hide();
    return;
  }
  thumb.classList.add("is-visible");
  window.clearTimeout(hideTimer);
  hideTimer = 0;
  ensureLoop();
}

function hide() {
  if (dragging) return;
  window.clearTimeout(hideTimer);
  hideTimer = 0;
  stopLoop();
  thumb?.classList.remove("is-visible");
  current = null;
}

function scheduleHide(delay = HIDE_DELAY) {
  if (dragging) return;
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    hideTimer = 0;
    if (current && current === hovered) return;
    hide();
  }, delay);
}

function handlePointerMove(event: PointerEvent) {
  if (dragging) return;
  // Keep the thumb alive while the pointer is on the thumb itself.
  if (event.target === thumb) return;
  const scroller = findScroller(event.target);
  hovered = scroller;
  if (scroller) {
    show(scroller);
    return;
  }
  if (current) scheduleHide();
}

function handlePointerOut(event: PointerEvent) {
  if (dragging || event.relatedTarget) return;
  hovered = null;
  if (current) scheduleHide(180);
}

function handleScroll(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target === current) {
    if (!dragging && !place(target)) hide();
    return;
  }
  // Touch input has no hover phase; reveal the thumb while it scrolls.
  if (!touchScrolling || !isVerticalScroller(target)) return;
  show(target);
  scheduleHide();
}

function handleThumbPointerDown(event: PointerEvent) {
  const element = current;
  if (!thumb || !element || event.button !== 0) return;
  event.preventDefault();
  dragging = true;
  window.clearTimeout(hideTimer);
  hideTimer = 0;
  thumb.classList.add("is-dragging");
  const startY = event.clientY;
  const startScroll = element.scrollTop;
  const track = element.clientHeight;
  const thumbHeight = thumb.getBoundingClientRect().height;
  const ratio =
    (element.scrollHeight - track) / Math.max(1, track - thumbHeight);
  const move = (moveEvent: PointerEvent) => {
    element.scrollTop = startScroll + (moveEvent.clientY - startY) * ratio;
  };
  const end = () => {
    dragging = false;
    thumb?.classList.remove("is-dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    scheduleHide(120);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

export function initializeOverlayScrollbars() {
  if (initialized) return;
  initialized = true;
  const mount = () => {
    // A stale thumb can survive a hot module reload.
    document
      .querySelectorAll(".overlay-scrollbar-thumb")
      .forEach((node) => node.remove());
    thumb = document.createElement("div");
    thumb.className = "overlay-scrollbar-thumb";
    thumb.setAttribute("aria-hidden", "true");
    document.body.appendChild(thumb);
    thumb.addEventListener("pointerdown", handleThumbPointerDown);
    document.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    document.addEventListener("pointerout", handlePointerOut, { passive: true });
    document.addEventListener("scroll", handleScroll, {
      capture: true,
      passive: true,
    });
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}
