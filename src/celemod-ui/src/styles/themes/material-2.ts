/**
 * Runtime affordances for Material Design 2.
 *
 * The stylesheet defines the visual language; this module supplies the parts
 * that need events (ink ripple, snackbar and dialog helpers). Theme context can
 * mount it whenever data-theme="material-2" is active and call the returned
 * cleanup function when switching away.
 */

const RIPPLE_CLASS = "md2-ripple";

export type Material2InteractionRoot = Document | HTMLElement;

const rootElement = (root: Material2InteractionRoot): HTMLElement | Document => root;

function showSnackbar(root: Material2InteractionRoot, message: string) {
  const host = root instanceof Document ? root.body : root;
  if (!host) return;
  const existing = host.querySelector<HTMLElement>(".md2-snackbar");
  existing?.remove();
  const snackbar = document.createElement("div");
  snackbar.className = "md2-snackbar";
  snackbar.setAttribute("role", "status");
  snackbar.textContent = message;
  host.appendChild(snackbar);
  requestAnimationFrame(() => snackbar.classList.add("is-visible"));
  const timeout = window.setTimeout(() => {
    snackbar.classList.remove("is-visible");
    window.setTimeout(() => snackbar.remove(), 180);
  }, 3200);
  snackbar.addEventListener("click", () => {
    window.clearTimeout(timeout);
    snackbar.remove();
  }, { once: true });
}

function openDialog(root: Material2InteractionRoot, selector: string) {
  const dialog = root.querySelector<HTMLElement>(selector);
  if (!dialog) return;
  dialog.removeAttribute("hidden");
  dialog.setAttribute("aria-hidden", "false");
  dialog.classList.add("is-visible");
  const close = dialog.querySelector<HTMLElement>("[data-dialog-close]");
  close?.focus();
}

function closeDialog(dialog: HTMLElement) {
  dialog.classList.remove("is-visible");
  dialog.setAttribute("aria-hidden", "true");
  window.setTimeout(() => dialog.setAttribute("hidden", ""), 180);
}

/** Mount M2 event affordances. Returns an idempotent cleanup function. */
export function mountMaterial2Interactions(root: Material2InteractionRoot = document): () => void {
  const target = rootElement(root);
  const onPointerDown = (event: PointerEvent) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      "button, [role=button], .fab, [class*=fab]",
    );
    if (!button || button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true") return;
    const rect = button.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = RIPPLE_CLASS;
    const diameter = Math.max(rect.width, rect.height) * 2;
    ripple.style.width = `${diameter}px`;
    ripple.style.height = `${diameter}px`;
    ripple.style.left = `${event.clientX - rect.left - diameter / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - diameter / 2}px`;
    button.querySelectorAll(`:scope > .${RIPPLE_CLASS}`).forEach((node) => node.remove());
    button.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  };

  const onClick = (event: MouseEvent) => {
    const targetElement = (event.target as HTMLElement | null);
    if (!targetElement) return;
    const snackbarTrigger = targetElement.closest<HTMLElement>("[data-snackbar]");
    if (snackbarTrigger) {
      const message = snackbarTrigger.dataset.snackbar;
      if (message) showSnackbar(root, message);
    }
    const dialogTrigger = targetElement.closest<HTMLElement>("[data-dialog-target]");
    if (dialogTrigger) {
      const selector = dialogTrigger.dataset.dialogTarget;
      if (selector) openDialog(root, selector);
    }
    const close = targetElement.closest<HTMLElement>("[data-dialog-close]");
    if (close) {
      const dialog = close.closest<HTMLElement>("[role=dialog], .popup-container, .md2-dialog");
      if (dialog) closeDialog(dialog);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    target.querySelectorAll<HTMLElement>(".is-visible[role=dialog], .is-visible.popup-container, .is-visible.md2-dialog")
      .forEach(closeDialog);
  };

  target.addEventListener("pointerdown", onPointerDown, true);
  target.addEventListener("click", onClick, true);
  target.addEventListener("keydown", onKeyDown, true);

  return () => {
    target.removeEventListener("pointerdown", onPointerDown, true);
    target.removeEventListener("click", onClick, true);
    target.removeEventListener("keydown", onKeyDown, true);
    target.querySelectorAll(`.${RIPPLE_CLASS}, .md2-snackbar`).forEach((node) => node.remove());
  };
}

/** Alias used by theme context integrations. */
export const applyThemeInteractions = mountMaterial2Interactions;

export interface Material2SnackbarOptions {
  actionLabel?: string;
  action?: () => void;
  duration?: number;
}

/** Public snackbar primitive for route code that needs an M2 transient message. */
export function showMaterial2Snackbar(
  root: Material2InteractionRoot = document,
  message: string,
  options: Material2SnackbarOptions = {},
): () => void {
  const host = root instanceof Document ? root.body : root;
  if (!host) return () => undefined;
  host.querySelectorAll<HTMLElement>(".md2-snackbar").forEach((node) => node.remove());
  const snackbar = document.createElement("div");
  snackbar.className = "md2-snackbar";
  snackbar.setAttribute("role", "status");
  const copy = document.createElement("span");
  copy.className = "md2-snackbar-message";
  copy.textContent = message;
  snackbar.append(copy);
  if (options.actionLabel && options.action) {
    const action = document.createElement("button");
    action.className = "md2-snackbar-action";
    action.type = "button";
    action.textContent = options.actionLabel;
    action.addEventListener("click", () => {
      options.action?.();
      dismiss();
    });
    snackbar.append(action);
  }
  host.append(snackbar);
  let dismissed = false;
  let timer = 0;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    window.clearTimeout(timer);
    snackbar.classList.remove("is-visible");
    window.setTimeout(() => snackbar.remove(), 180);
  };
  const duration = Math.max(1500, options.duration ?? 3200);
  timer = window.setTimeout(dismiss, duration);
  requestAnimationFrame(() => snackbar.classList.add("is-visible"));
  snackbar.addEventListener("pointerdown", () => window.clearTimeout(timer), { once: true });
  return dismiss;
}

/** Apply one of the four Material elevation steps to a surface element. */
export function setMaterial2Elevation(element: HTMLElement, level: 0 | 1 | 2 | 3 | 4): void {
  element.classList.remove(
    "md2-elevation-0",
    "md2-elevation-1",
    "md2-elevation-2",
    "md2-elevation-3",
    "md2-elevation-4",
  );
  element.classList.add(`md2-elevation-${level}`);
  element.dataset.md2Elevation = String(level);
}

/** Restore focus to a trigger after closing a dialog. */
export function closeMaterial2Dialog(dialog: HTMLElement, trigger?: HTMLElement | null): void {
  dialog.classList.remove("is-visible");
  dialog.setAttribute("aria-hidden", "true");
  window.setTimeout(() => dialog.setAttribute("hidden", ""), 180);
  trigger?.focus({ preventScroll: true });
}

/** Install keyboard focus trapping for a dialog and return its cleanup callback. */
export function trapMaterial2DialogFocus(dialog: HTMLElement): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    )).filter((node) => node.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener("keydown", onKeyDown);
  return () => dialog.removeEventListener("keydown", onKeyDown);
}

/** Add M2 keyboard ripple feedback to a control (useful for custom role=button nodes). */
export function rippleMaterial2Control(control: HTMLElement, key = "Enter"): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== key && event.key !== " ") return;
    const rect = control.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = RIPPLE_CLASS;
    const diameter = Math.max(rect.width, rect.height) * 2;
    ripple.style.width = `${diameter}px`;
    ripple.style.height = `${diameter}px`;
    ripple.style.left = `${(rect.width - diameter) / 2}px`;
    ripple.style.top = `${(rect.height - diameter) / 2}px`;
    control.querySelectorAll(`:scope > .${RIPPLE_CLASS}`).forEach((node) => node.remove());
    control.append(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  };
  control.addEventListener("keydown", onKeyDown);
  return () => control.removeEventListener("keydown", onKeyDown);
}
