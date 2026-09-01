const REVEAL_SELECTOR = [
  "button",
  ".navBtn",
  ".downloadListBtn",
  ".theme-picker-card",
  ".search-result-card",
  ".mod-card",
  ".manage-tree-row",
  ".channel-card",
  ".profile",
].join(",");

const OVERLAY_SELECTOR = [
  ".filter-popup",
  ".manage-filter-popup",
  ".manage-action-menu",
  ".popup-content",
  ".download-list-menu",
  ".context-menu",
  "[role='menu']",
  "[role='dialog']",
].join(",");

const COMMAND_BAR_SELECTOR = [
  ".filter",
  ".manage-toolbar",
  ".keybindings-toolbar",
].join(",");

type Cleanup = () => void;

const listen = <K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: AddEventListenerOptions,
): Cleanup => {
  target.addEventListener(type, handler as EventListener, options);
  return () => target.removeEventListener(type, handler as EventListener, options);
};

const listenWindow = <K extends keyof WindowEventMap>(
  type: K,
  handler: (event: WindowEventMap[K]) => void,
): Cleanup => {
  window.addEventListener(type, handler);
  return () => window.removeEventListener(type, handler);
};

const setRevealCoordinates = (event: PointerEvent) => {
  const target = (event.target as Element | null)?.closest<HTMLElement>(
    REVEAL_SELECTOR,
  );
  if (!target) return;
  const rect = target.getBoundingClientRect();
  target.style.setProperty("--fluent-reveal-x", `${event.clientX - rect.left}px`);
  target.style.setProperty("--fluent-reveal-y", `${event.clientY - rect.top}px`);
  target.style.setProperty("--fluent-reveal-opacity", "1");
};

const clearReveal = (event: PointerEvent) => {
  const target = (event.target as Element | null)?.closest<HTMLElement>(
    REVEAL_SELECTOR,
  );
  target?.style.setProperty("--fluent-reveal-opacity", "0");
};

const setOverlayOrigin = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  const horizontal = rect.left + rect.width / 2 > window.innerWidth / 2
    ? "right"
    : "left";
  const vertical = rect.top + rect.height / 2 > window.innerHeight / 2
    ? "bottom"
    : "top";
  element.style.setProperty("--fluent-overlay-origin", `${vertical} ${horizontal}`);
};

const decorateOverlay = (element: Element) => {
  if (!(element instanceof HTMLElement)) return;
  if (!element.matches(OVERLAY_SELECTOR)) return;
  element.dataset.fluentLayer = "acrylic";
  setOverlayOrigin(element);
};

const scanOverlays = (root: ParentNode) => {
  if (root instanceof Element) decorateOverlay(root);
  root.querySelectorAll(OVERLAY_SELECTOR).forEach(decorateOverlay);
};

const decorateCommandBar = (element: Element) => {
  if (!(element instanceof HTMLElement)) return;
  if (!element.matches(COMMAND_BAR_SELECTOR)) return;
  element.dataset.fluentCommandBar = "true";
  element.querySelectorAll<HTMLElement>("button").forEach((button, index) => {
    button.dataset.fluentCommandIndex = `${index}`;
  });
};

const scanCommandBars = (root: ParentNode) => {
  if (root instanceof Element) decorateCommandBar(root);
  root.querySelectorAll(COMMAND_BAR_SELECTOR).forEach(decorateCommandBar);
};

const updateMicaState = () => {
  const root = document.documentElement;
  root.dataset.fluentWindow = document.hasFocus() ? "active" : "inactive";
  root.style.setProperty(
    "--fluent-mica-opacity",
    document.hasFocus() ? ".84" : ".94",
  );
};

const updateNavigationPosition = () => {
  const selected = document.querySelector<HTMLElement>(".sidebar .navBtn.selected");
  const sidebar = document.querySelector<HTMLElement>(".sidebar");
  if (!selected || !sidebar) return;
  const sidebarRect = sidebar.getBoundingClientRect();
  const selectedRect = selected.getBoundingClientRect();
  sidebar.style.setProperty(
    "--fluent-nav-indicator-y",
    `${selectedRect.top - sidebarRect.top}px`,
  );
  sidebar.dataset.fluentNavigationView = "compact";
};

const setKeyboardModality = (enabled: boolean) => {
  document.documentElement.dataset.fluentKeyboard = enabled ? "true" : "false";
};

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.metaKey || event.altKey || event.ctrlKey) return;
  setKeyboardModality(true);
};

const handlePointerDown = () => {
  setKeyboardModality(false);
};

const handleFocusIn = (event: FocusEvent) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  target.dataset.fluentFocused = "true";
};

const handleFocusOut = (event: FocusEvent) => {
  const target = event.target as HTMLElement | null;
  delete target?.dataset.fluentFocused;
};

export const mountFluentInteractions = (): Cleanup => {
  const root = document.documentElement;
  root.dataset.fluentMounted = "true";
  root.dataset.fluentKeyboard = "false";
  root.dataset.fluentMaterial = "mica";
  updateMicaState();
  updateNavigationPosition();
  scanOverlays(document);
  scanCommandBars(document);

  const cleanup: Cleanup[] = [
    listen(document, "pointermove", setRevealCoordinates, { passive: true }),
    listen(document, "pointerout", clearReveal, { passive: true }),
    listen(document, "pointerdown", handlePointerDown, { passive: true }),
    listen(document, "keydown", handleKeyDown),
    listen(document, "focusin", handleFocusIn),
    listen(document, "focusout", handleFocusOut),
    listenWindow("focus", updateMicaState),
    listenWindow("blur", updateMicaState),
    listenWindow("resize", updateNavigationPosition),
  ];

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") updateNavigationPosition();
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        scanOverlays(node);
        scanCommandBars(node);
      });
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "open", "aria-expanded"],
  });

  return () => {
    observer.disconnect();
    cleanup.forEach((dispose) => dispose());
    document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR).forEach((element) => {
      element.style.removeProperty("--fluent-reveal-x");
      element.style.removeProperty("--fluent-reveal-y");
      element.style.removeProperty("--fluent-reveal-opacity");
    });
    document.querySelectorAll<HTMLElement>("[data-fluent-layer]").forEach(
      (element) => delete element.dataset.fluentLayer,
    );
    document.querySelectorAll<HTMLElement>("[data-fluent-command-bar]").forEach(
      (element) => delete element.dataset.fluentCommandBar,
    );
    delete root.dataset.fluentMounted;
    delete root.dataset.fluentKeyboard;
    delete root.dataset.fluentMaterial;
    delete root.dataset.fluentWindow;
    root.style.removeProperty("--fluent-mica-opacity");
  };
};

export const applyFluentInteractions = mountFluentInteractions;
