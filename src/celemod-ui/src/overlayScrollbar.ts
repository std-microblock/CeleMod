import "./overlayScrollbar.scss";

/**
 * Floating scrollbar thumb, driven entirely by pointer and scroll activity.
 *
 * Chromium cannot render an overlay scrollbar from CSS: a styled
 * `::-webkit-scrollbar` always reserves layout width and the overlay values
 * (`overflow: overlay`, `scrollbar-width: overlay`) no longer exist. So the
 * native scrollbars are hidden in `i2.css` and this module paints a single
 * `position: fixed` thumb, which consumes no layout space:
 *
 * - inside a scrollable area the pointer reveals the thumb,
 * - wheels/touch keep it visible while the area scrolls,
 * - it fades out after `IDLE_HIDE_DELAY` ms without any movement, and as soon
 *   as the pointer leaves the area.
 */

const THUMB_WIDTH = 4;
const THUMB_INSET = 3;
const MIN_THUMB_HEIGHT = 28;
/** How long the thumb lingers after the last pointer move or scroll. */
const IDLE_HIDE_DELAY = 1200;

let thumb: HTMLDivElement | null = null;
let active: HTMLElement | null = null;
let hovered: HTMLElement | null = null;
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
  let element: Element | null = target instanceof Element ? target : null;
  while (element) {
    if (isVerticalScroller(element)) return element;
    element = element.parentElement;
  }
  return null;
}

/** Positions the thumb over `element`; returns false if there is nothing to scroll. */
function place(element: HTMLElement): boolean {
  if (!thumb) return false;
  const rect: DOMRect = element.getBoundingClientRect();
  const track: number = element.clientHeight;
  const total: number = element.scrollHeight;
  const maxScroll: number = total - track;
  if (track <= 0 || maxScroll <= 1) return false;
  const height: number = Math.min(
    track,
    Math.max(MIN_THUMB_HEIGHT, (track * track) / total),
  );
  const progress: number = Math.min(1, Math.max(0, element.scrollTop / maxScroll));
  const top: number =
    rect.top + element.clientTop + (track - height) * progress;
  const borderRight: number =
    element.offsetWidth - element.clientWidth - element.clientLeft;
  const left: number = rect.right - borderRight - THUMB_INSET - THUMB_WIDTH;
  thumb.style.top = `${Math.round(top)}px`;
  thumb.style.left = `${Math.round(left)}px`;
  thumb.style.height = `${Math.round(height)}px`;
  return true;
}

function frameLoop(): void {
  frame = 0;
  if (!active || !thumb || !thumb.classList.contains("is-visible")) return;
  if (!active.isConnected || !place(active)) {
    hide();
    return;
  }
  frame = requestAnimationFrame(frameLoop);
}

function stopLoop(): void {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

function show(element: HTMLElement): void {
  if (!thumb) return;
  if (!place(element)) {
    hide();
    return;
  }
  active = element;
  thumb.classList.add("is-visible");
  if (!frame) frame = requestAnimationFrame(frameLoop);
  scheduleHide();
}

function hide(): void {
  window.clearTimeout(hideTimer);
  hideTimer = 0;
  stopLoop();
  thumb?.classList.remove("is-visible");
  active = null;
}

function scheduleHide(delay: number = IDLE_HIDE_DELAY): void {
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    hideTimer = 0;
    hide();
  }, delay);
}

function handlePointerMove(event: PointerEvent): void {
  const scroller = findScroller(event.target);
  hovered = scroller;
  if (scroller) show(scroller);
  else hide();
}

function handlePointerOut(event: PointerEvent): void {
  if (event.relatedTarget) return;
  hovered = null;
  hide();
}

function handleScroll(event: Event): void {
  const target: EventTarget | null = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target === active) {
    if (!place(target)) hide();
    else scheduleHide();
    return;
  }
  // Wheel and touch scrolling keep the pointer still, so the scroll itself has
  // to reveal the thumb of the area the pointer is over.
  if (target !== hovered) return;
  if (!isVerticalScroller(target)) return;
  show(target);
}

export function initializeOverlayScrollbars(): void {
  if (initialized) return;
  initialized = true;
  const mount = (): void => {
    // A stale thumb can survive a hot module reload.
    document
      .querySelectorAll(".overlay-scrollbar-thumb")
      .forEach((node: Element) => node.remove());
    thumb = document.createElement("div");
    thumb.className = "overlay-scrollbar-thumb";
    thumb.setAttribute("aria-hidden", "true");
    document.body.appendChild(thumb);
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
