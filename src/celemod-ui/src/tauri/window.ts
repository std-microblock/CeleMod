export type DesktopPlatform = "windows" | "macos" | "linux" | "android";

export function detectDesktopPlatform(): DesktopPlatform {
  if (/android/i.test(navigator.userAgent)) return "android";
  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform =
    navigatorWithUserAgentData.userAgentData?.platform ??
    navigator.platform ??
    navigator.userAgent;
  if (/win/i.test(platform)) return "windows";
  if (/mac|iphone|ipad|ipod/i.test(platform)) return "macos";
  return "linux";
}

export function initializeWindowChrome() {
  document.documentElement.dataset.platform = detectDesktopPlatform();
  const compact = window.matchMedia("(max-width: 760px)");
  const updateLayout = () => {
    document.documentElement.toggleAttribute(
      "data-mobile-layout",
      detectDesktopPlatform() === "android" || compact.matches,
    );
  };
  updateLayout();
  compact.addEventListener("change", updateLayout);
}
