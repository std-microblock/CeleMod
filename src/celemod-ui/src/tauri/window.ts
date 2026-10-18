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

/**
 * Mobile layout is a property of the platform, not of the window width.
 *
 * The interface scale is applied with WebView zoom (`setZoom`), which shrinks
 * the CSS viewport: a 1100px window at 150% reports `innerWidth === 733`, so a
 * `(max-width: 760px)` check switched desktop users to the Android layout
 * (sidebar hidden, bottom navigation shown). Desktop windows also cannot get
 * narrower than `minWidth` (800px), so the width check only ever fired because
 * of that zoom.
 */
export function isMobileLayout(): boolean {
  return detectDesktopPlatform() === "android";
}

export function initializeWindowChrome() {
  const platform = detectDesktopPlatform();
  document.documentElement.dataset.platform = platform;
  document.documentElement.toggleAttribute("data-mobile-layout", isMobileLayout());
}
