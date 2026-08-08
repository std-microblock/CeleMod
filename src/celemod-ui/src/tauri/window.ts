export type DesktopPlatform = "windows" | "macos" | "linux";

export function detectDesktopPlatform(): DesktopPlatform {
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
}
