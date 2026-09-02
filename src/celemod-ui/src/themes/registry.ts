import vanillaPreview from "../assets/theme-previews/vanilla.png";
import materialYouPreview from "../assets/theme-previews/material-you.png";
import fluentPreview from "../assets/theme-previews/fluent.png";

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
    preview: vanillaPreview,
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
    preview: materialYouPreview,
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
    preview: fluentPreview,
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
] as const satisfies readonly ThemeDefinition[];

export type ThemeId = (typeof THEME_REGISTRY)[number]["id"];
export const DEFAULT_THEME_ID: ThemeId = "vanilla";
export const getTheme = (id: string | null | undefined): ThemeDefinition =>
  THEME_REGISTRY.find((theme) => theme.id === id) ?? THEME_REGISTRY[0];
export const themePreview = (id: string | null | undefined) =>
  getTheme(id).preview;
