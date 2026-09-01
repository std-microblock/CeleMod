export type LinearDensity = "comfortable" | "compact" | "dense";

export interface LinearThemeTokens {
  canvas: string;
  surface: string;
  surfaceRaised: string;
  accent: string;
  accentSecondary: string;
  text: string;
  muted: string;
  divider: string;
  radius: number;
  controlHeight: number;
  density: LinearDensity;
}

export const linearTokens: LinearThemeTokens = {
  canvas: "#08090a",
  surface: "#101114",
  surfaceRaised: "#17181c",
  accent: "#7c6df2",
  accentSecondary: "#56a8ff",
  text: "#f4f5f6",
  muted: "#8b8f98",
  divider: "rgba(255,255,255,.095)",
  radius: 8,
  controlHeight: 32,
  density: "compact",
};

export const linearKeyboard = {
  commandMenu: ["Meta", "k"],
  quickSearch: ["/"],
  closeOverlay: ["Escape"],
  navigateNext: ["ArrowDown"],
  navigatePrevious: ["ArrowUp"],
} as const;

export const isLinearTheme = (root: ParentNode = document) =>
  typeof Document !== "undefined" && root instanceof Document
    ? root.documentElement.dataset.theme === "linear"
    : root.querySelector<HTMLElement>('html[data-theme="linear"]') !== null;

export const setLinearDensity = (
  density: LinearDensity,
  root: HTMLElement = document.documentElement,
) => {
  root.dataset.linearDensity = density;
};

export const linearControlStyle = (focused = false) => ({
  minHeight: `${linearTokens.controlHeight}px`,
  borderRadius: `${linearTokens.radius}px`,
  borderColor: focused ? linearTokens.accent : linearTokens.divider,
  backgroundColor: linearTokens.surface,
});

export const linearMotion = {
  fast: "120ms",
  normal: "160ms",
  slow: "240ms",
  easing: "cubic-bezier(.22,1,.36,1)",
} as const;

