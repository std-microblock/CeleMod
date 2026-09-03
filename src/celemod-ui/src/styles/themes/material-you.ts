/** Material You interaction hooks. Call installMaterialYouInteractions() once from the app root. */
export const installMaterialYouInteractions = () => {
  if (typeof window === "undefined" || document.documentElement.dataset.materialYouHooks === "installed") return () => {};
  document.documentElement.dataset.materialYouHooks = "installed";
  const cleanups: Array<() => void> = [];
  const isMaterialYou = () => document.documentElement.dataset.theme === "material-you";
  const onPointerDown = (event: PointerEvent) => {
    if (!isMaterialYou()) return;
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("button, [role='button'], .md-ripple-host");
    if (!target || target.matches(":disabled, [aria-disabled='true']")) return;
    const rect = target.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const radius = Math.hypot(
      Math.max(x, rect.width - x),
      Math.max(y, rect.height - y),
    );
    const isRailButton = target.matches(".sidebar .navBtn");
    const rippleRadius = isRailButton ? 23 : radius;
    const rippleX = isRailButton ? Math.min(55, Math.max(9, x)) : x;
    const rippleY = isRailButton ? Math.min(31, Math.max(3, y)) : y;
    target.style.setProperty("--md-pointer-x", `${x}px`);
    target.style.setProperty("--md-pointer-y", `${y}px`);
    target.classList.remove("md-ripple-active");
    target.querySelectorAll(":scope > .md-ripple").forEach((node) => node.remove());
    const ripple = document.createElement("span");
    ripple.className = "md-ripple";
    ripple.style.width = `${rippleRadius * 2}px`;
    ripple.style.height = `${rippleRadius * 2}px`;
    ripple.style.left = `${rippleX - rippleRadius}px`;
    ripple.style.top = `${rippleY - rippleRadius}px`;
    target.appendChild(ripple);
    target.classList.add("md-ripple-active", "md-shape-morph");
    const remove = () => { ripple.remove(); target.classList.remove("md-ripple-active"); };
    ripple.addEventListener("animationend", remove, { once: true });
    window.setTimeout(remove, 650);
  };
  const onPointerUp = (event: PointerEvent) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("button, [role='button'], .md-ripple-host");
    target?.classList.remove("md-shape-morph");
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!isMaterialYou()) return;
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("button, [role='button'], .md-reveal");
    if (!target) return;
    const rect = target.getBoundingClientRect();
    target.style.setProperty("--md-pointer-x", `${event.clientX - rect.left}px`);
    target.style.setProperty("--md-pointer-y", `${event.clientY - rect.top}px`);
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerUp, true);
  document.addEventListener("pointermove", onPointerMove, true);
  cleanups.push(() => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerUp, true);
    document.removeEventListener("pointermove", onPointerMove, true);
  });
  const observer = new MutationObserver(() => {
    const active = isMaterialYou();
    document.querySelectorAll<HTMLElement>(".md-tonal-surface").forEach((node) => node.classList.toggle("md-tonal-active", active));
    if (!active) {
      document.querySelectorAll<HTMLElement>(".md-ripple").forEach((node) => node.remove());
      document.querySelectorAll<HTMLElement>(".md-ripple-active, .md-shape-morph").forEach((node) => node.classList.remove("md-ripple-active", "md-shape-morph"));
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  cleanups.push(() => observer.disconnect());
  return () => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    delete document.documentElement.dataset.materialYouHooks;
  };
};

export const materialYouTonal = (tone: "primary" | "secondary" | "tertiary" | "surface" = "surface") => ({
  "data-md-tonal": tone,
  className: "md-tonal-surface",
});
