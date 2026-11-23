import { type ComponentType, createContext, createElement } from "react";
import { createRoot } from "react-dom/client";
import { prefersReducedMotion } from "./Motion";

export const PopupContext = createContext<{ hide(): void }>({ hide() {} });

export const createPopup = (
  Content: ComponentType,
  {
    cancelable = true,
    backgroundMask = "rgba(0, 0, 0, 0.5)",
    className = "",
  }: { cancelable?: boolean; backgroundMask?: string; className?: string } = {},
) => {
  const container = document.createElement("div");
  container.className = ["popup-container", className]
    .filter(Boolean)
    .join(" ");
  container.style.background = backgroundMask;
  document.body.appendChild(container);
  const root = createRoot(container);

  let closed = false;
  let raf1 = 0;
  let raf2 = 0;

  const openNow = () => {
    if (closed) return;
    container.dataset.state = "open";
    container.style.opacity = "1";
  };

  const controls = {
    show() {
      if (closed) return;
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      raf1 = 0;
      raf2 = 0;
      if (prefersReducedMotion()) {
        openNow();
        return;
      }
      raf1 = requestAnimationFrame(() => {
        raf1 = 0;
        raf2 = requestAnimationFrame(() => {
          raf2 = 0;
          openNow();
        });
      });
    },
    hide() {
      if (closed) return;
      closed = true;
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      raf1 = 0;
      raf2 = 0;
      container.dataset.state = "closing";
      container.style.opacity = "0";
      container.style.pointerEvents = "none";
      window.setTimeout(() => {
        root.unmount();
        container.remove();
      }, prefersReducedMotion() ? 0 : 210);
    },
  };

  container.addEventListener("click", (event) => {
    if (cancelable && event.target === container) controls.hide();
  });
  root.render(
    <PopupContext.Provider value={controls}>
      {createElement(Content)}
    </PopupContext.Provider>,
  );
  controls.show();
  return controls;
};
