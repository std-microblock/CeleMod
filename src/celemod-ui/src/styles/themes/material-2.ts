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
