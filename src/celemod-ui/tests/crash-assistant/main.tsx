import { createRoot } from "react-dom/client";
import { CrashAssistant } from "../../src/components/CrashAssistant";
import "../../src/index.scss";

// Geometry probe: the crash assistant is a blocking overlay, so its heading,
// close button and action buttons must always stay reachable. When the window
// is too short for the fixed rows the popup scrolls, which means the footer is
// reachable at the bottom of the scroll range instead of at the top.
const rect = (element: Element | null) => {
  if (!element) return null;
  const box = element.getBoundingClientRect();
  return {
    top: Math.round(box.top),
    bottom: Math.round(box.bottom),
    height: Math.round(box.height),
  };
};

const publishMetrics = () => {
  const container = document.querySelector(
    ".popup-container.crash-popup-container",
  );
  const popup = document.querySelector(
    ".crash-assistant-popup",
  ) as HTMLElement | null;
  const buttons = Array.from(
    document.querySelectorAll(".crash-actions button"),
  ) as HTMLElement[];
  const ignore = buttons.find((button) => button.textContent?.includes("忽略"));

  const sample = () => ({
    heading: rect(document.querySelector(".crash-popup-heading")),
    close: rect(document.querySelector(".crash-close")),
    summary: rect(document.querySelector(".crash-summary-line")),
    grid: rect(document.querySelector(".crash-main-grid")),
    advice: rect(document.querySelector(".crash-advice")),
    report: rect(document.querySelector(".crash-report-file")),
    actions: rect(document.querySelector(".crash-actions")),
    ignore: rect(ignore ?? null),
  });

  if (popup) popup.scrollTop = 0;
  const topState = sample();
  if (popup) popup.scrollTop = popup.scrollHeight;
  const bottomState = sample();
  if (popup) popup.scrollTop = 0;

  const metrics = {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    containerTransform: container
      ? getComputedStyle(container).transform
      : null,
    container: rect(container),
    popupScrollable: popup
      ? popup.scrollHeight > popup.clientHeight + 1
      : false,
    popupWidths: popup
      ? { client: popup.clientWidth, scroll: popup.scrollWidth }
      : null,
    topState,
    bottomState,
    buttons: buttons.map((button) => button.textContent),
    title: document.querySelector(".crash-summary-line strong")?.textContent,
    trace: (
      document.querySelector(".crash-excerpt") as HTMLElement | null
    )?.textContent?.slice(0, 160),
  };
  document.documentElement.dataset.crashMetrics = JSON.stringify(metrics);
};

new MutationObserver(() => {
  if (document.querySelector(".crash-assistant-popup"))
    window.setTimeout(publishMetrics, 500);
}).observe(document.body, { childList: true, subtree: true });

createRoot(document.getElementById("root")!).render(<CrashAssistant />);
window.setTimeout(publishMetrics, 2000);
