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
    target.style.setProperty("--md-pointer-x", `${event.clientX - rect.left}px`);
    target.style.setProperty("--md-pointer-y", `${event.clientY - rect.top}px`);
    target.classList.remove("md-ripple-active");
    const ripple = document.createElement("span");
    ripple.className = "md-ripple";
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    const diameter = Math.max(rect.width, rect.height) * 1.8;
    ripple.style.width = `${diameter}px`;
    ripple.style.height = `${diameter}px`;
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
