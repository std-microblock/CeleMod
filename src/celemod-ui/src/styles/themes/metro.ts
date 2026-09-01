/** Runtime interaction layer for the Metro theme.
 *
 * Metro motion is deliberately mechanical: pointer highlights, hard press
 * states and a short accent "flash" confirm activation. The delegated listeners keep this
 * independent of React route mounts and are removed by the returned cleanup.
 */
export function mountMetroInteractions(root: Document = document): () => void {
  const isMetro = () => {
    const id = root.documentElement?.dataset.theme;
    return id === "metro" || id === "win10";
  };

  const tileSelector = [
    ".sidebar .navBtn",
    ".downloadListBtn",
    ".home-profiles-section .profile",
    ".search-result-card",
    ".recommended-map-card",
    ".channel-card",
    ".settings-card",
  ].join(",");

  const onPointerMove = (event: PointerEvent) => {
    if (!isMetro()) return;
    const target = (event.target as Element | null)?.closest<HTMLElement>(tileSelector);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    target.style.setProperty("--metro-pointer-x", `${Math.round(event.clientX - rect.left)}px`);
    target.style.setProperty("--metro-pointer-y", `${Math.round(event.clientY - rect.top)}px`);
    // Highlight follows pointer coordinates without changing geometry.
  };

  const onPointerLeave = (event: PointerEvent) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>(tileSelector);
    if (!target) return;
    const related = event.relatedTarget as Node | null;
    if (related && target.contains(related)) return;
    target.style.removeProperty("--metro-pointer-x");
    target.style.removeProperty("--metro-pointer-y");
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isMetro() || (event.key !== "Enter" && event.key !== " ")) return;
    const target = (event.target as Element | null)?.closest<HTMLElement>(
      "button, .home-profiles-section .profile, .search-result-card",
    );
    if (!target || target.dataset.metroRipple === "off") return;
    target.classList.add("metro-key-press");
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = (event.target as Element | null)?.closest<HTMLElement>(
      "button, .home-profiles-section .profile, .search-result-card",
    );
    if (!target) return;
    target.classList.remove("metro-key-press");
    target.classList.remove("metro-ink-pulse");
    void target.offsetWidth;
    target.classList.add("metro-ink-pulse");
    window.setTimeout(() => target.classList.remove("metro-ink-pulse"), 260);
  };

  const onFocus = (event: FocusEvent) => {
    if (!isMetro()) return;
    const target = (event.target as Element | null)?.closest<HTMLElement>(tileSelector);
    if (target) target.dataset.metroFocused = "true";
  };

  const onBlur = (event: FocusEvent) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>(tileSelector);
    if (target) delete target.dataset.metroFocused;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!isMetro()) return;
    const target = (event.target as Element | null)?.closest<HTMLElement>("button, .home-profiles-section .profile, .search-result-card");
    if (!target || target.dataset.metroRipple === "off") return;
    target.classList.remove("metro-ink-pulse");
    // Force reflow so repeated clicks restart the animation.
    void target.offsetWidth;
    target.classList.add("metro-ink-pulse");
    window.setTimeout(() => target.classList.remove("metro-ink-pulse"), 260);
  };

  root.addEventListener("pointermove", onPointerMove, { passive: true });
  root.addEventListener("pointerout", onPointerLeave, { passive: true });
  root.addEventListener("pointerdown", onPointerDown, { passive: true });
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("keyup", onKeyUp);
  root.addEventListener("focusin", onFocus);
  root.addEventListener("focusout", onBlur);

  return () => {
    root.removeEventListener("pointermove", onPointerMove);
    root.removeEventListener("pointerout", onPointerLeave);
    root.removeEventListener("pointerdown", onPointerDown);
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("keyup", onKeyUp);
    root.removeEventListener("focusin", onFocus);
    root.removeEventListener("focusout", onBlur);
  };
}

export const applyThemeInteractions = mountMetroInteractions;
