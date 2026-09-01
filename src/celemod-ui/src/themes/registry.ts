const svg = (bg: string, accent: string, shape: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${bg}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs><rect width="320" height="180" rx="16" fill="url(#g)"/><rect x="20" y="24" width="280" height="132" rx="12" fill="rgba(0,0,0,.2)"/><rect x="36" y="42" width="90" height="12" rx="6" fill="rgba(255,255,255,.85)"/><rect x="36" y="66" width="180" height="8" rx="4" fill="rgba(255,255,255,.4)"/>${shape}</svg>`
  )}`;

export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  preview: string;
  variables: Record<string, string>;
  features: string[];
}

export const THEME_REGISTRY = [
  {
    id: "vanilla",
    name: "Vanilla",
    description: "CeleMod classic dark glass interface",
    preview: svg(
      "#18181b",
      "#a77fdb",
      '<rect x="36" y="94" width="116" height="42" rx="8" fill="rgba(255,255,255,.12)"/><rect x="164" y="94" width="120" height="42" rx="8" fill="rgba(255,255,255,.08)"/>'
    ),
    variables: {
      bg: "#131313",
      bg1: "#222222",
      bg2: "#333333",
      bg3: "#444444",
      fg: "#ffffff",
      fg1: "#d1d1d1",
      fg2: "#bbbbbb",
      fg3: "#aaaaaa",
      primary: "#a77fdb",
      radius: "14px",
      elevation: "0 12px 32px rgba(0,0,0,.12)",
      font: "system-ui, -apple-system, sans-serif",
    },
    features: ["glass", "dark"],
  },
  {
    id: "material-you",
    name: "Material You",
    description: "Expressive surfaces, dynamic color and playful ripple motion",
    preview: svg(
      "#6750a4",
      "#d0bcff",
      '<circle cx="254" cy="74" r="28" fill="rgba(255,255,255,.3)"/><rect x="36" y="96" width="248" height="40" rx="20" fill="rgba(255,255,255,.2)"/>'
    ),
    variables: {
      bg: "#141218",
      bg1: "#211f26",
      bg2: "#302d38",
      bg3: "#49454f",
      fg: "#e6e0e9",
      fg1: "#cac4d0",
      fg2: "#938f99",
      fg3: "#79747e",
      primary: "#d0bcff",
      radius: "20px",
      elevation: "0 4px 12px rgba(0,0,0,.28)",
      font: "system-ui, sans-serif",
    },
    features: ["ripple", "tonal-surfaces", "dynamic-color"],
  },
  {
    id: "fluent",
    name: "Fluent Design",
    description:
      "Windows Fluent translucency, soft depth and reveal highlights",
    preview: svg(
      "#0b1728",
      "#4cc2ff",
      '<circle cx="250" cy="102" r="54" fill="rgba(76,194,255,.35)"/><rect x="38" y="96" width="132" height="40" rx="4" fill="rgba(255,255,255,.14)"/>'
    ),
    variables: {
      bg: "#0f1115",
      bg1: "#1a1c20",
      bg2: "#25282d",
      bg3: "#32363c",
      fg: "#f5f5f5",
      fg1: "#d6d6d6",
      fg2: "#a8a8a8",
      fg3: "#858585",
      primary: "#4cc2ff",
      radius: "8px",
      elevation: "0 8px 28px rgba(0,0,0,.35)",
      font: "Segoe UI, system-ui, sans-serif",
    },
    features: ["acrylic", "reveal", "depth"],
  },
  {
    id: "linear",
    name: "Linear / NextUI",
    description:
      "Focused product UI with crisp borders, gradients and compact density",
    preview: svg(
      "#0b0d12",
      "#5e6ad2",
      '<rect x="36" y="96" width="248" height="40" rx="6" fill="rgba(255,255,255,.1)"/><circle cx="260" cy="54" r="8" fill="#5e6ad2"/>'
    ),
    variables: {
      bg: "#0b0d12",
      bg1: "#111318",
      bg2: "#191b23",
      bg3: "#242735",
      fg: "#f7f8f8",
      fg1: "#d5d7dc",
      fg2: "#9b9da7",
      fg3: "#6f7280",
      primary: "#5e6ad2",
      radius: "8px",
      elevation: "0 4px 18px rgba(0,0,0,.25)",
      font: "Inter, ui-sans-serif, system-ui, sans-serif",
    },
    features: ["compact", "gradient-borders", "command-menu"],
  },
  {
    id: "metro",
    name: "Windows 10 Metro",
    description: "Bold tile layout, accent blocks, glow and 3D hover depth",
    preview: svg(
      "#101820",
      "#0078d4",
      '<rect x="36" y="94" width="76" height="42" fill="#0078d4"/><rect x="120" y="94" width="76" height="42" fill="#00a4ef"/><rect x="204" y="94" width="80" height="42" fill="#7fba00"/>'
    ),
    variables: {
      bg: "#101820",
      bg1: "#17232f",
      bg2: "#203243",
      bg3: "#2b4358",
      fg: "#ffffff",
      fg1: "#e6f2ff",
      fg2: "#b7c9d9",
      fg3: "#8fa5b8",
      primary: "#0078d4",
      radius: "0px",
      elevation: "4px 4px 0 #005a9e",
      font: "Segoe UI, system-ui, sans-serif",
    },
    features: ["tiles", "glow", "perspective-3d"],
  },
  {
    id: "material-2",
    name: "Material Design 2",
    description:
      "Structured elevation, 4dp rhythm and confident accent actions",
    preview: svg(
      "#121212",
      "#bb86fc",
      '<rect x="36" y="96" width="116" height="40" rx="4" fill="#bb86fc"/><rect x="164" y="96" width="120" height="40" rx="4" fill="rgba(255,255,255,.12)"/>'
    ),
    variables: {
      bg: "#121212",
      bg1: "#1e1e1e",
      bg2: "#2a2a2a",
      bg3: "#373737",
      fg: "#ffffff",
      fg1: "#e0e0e0",
      fg2: "#b3b3b3",
      fg3: "#8a8a8a",
      primary: "#bb86fc",
      radius: "4px",
      elevation: "0 2px 6px rgba(0,0,0,.35)",
      font: "Roboto, system-ui, sans-serif",
    },
    features: ["elevation", "4dp-grid", "ink-ripple"],
  },
] as const satisfies readonly ThemeDefinition[];

export type ThemeId = (typeof THEME_REGISTRY)[number]["id"];
export const DEFAULT_THEME_ID: ThemeId = "vanilla";
export const getTheme = (id: string | null | undefined): ThemeDefinition =>
  THEME_REGISTRY.find((theme) => theme.id === id) ?? THEME_REGISTRY[0];
export const themePreview = (id: string | null | undefined) =>
  getTheme(id).preview;
