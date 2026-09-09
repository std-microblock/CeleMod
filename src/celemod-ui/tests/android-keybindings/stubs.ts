import type { TouchButton, TouchEntry } from "../../src/routes/touchButtons";
export default { t: (key: string) => ({ binding_Jump: "跳跃", binding_Left: "向左" }[key] ?? key) };
export const useGamePath = () => ["fixture-only"];
export const useCurrentLang = () => ({ currentLang: "zh-CN" });
const entry = (source: string, action: string, label: string, overrides: Partial<TouchEntry> = {}): TouchEntry => ({
  source, sourceKind: "mod", actionPath: `/${action}`, action, label, format: "standard", enabled: true, installed: true, ...overrides,
});
const entries = [
  entry("MiaoNet", "ChatButton", "打开聊天栏"),
  entry("Tools", "OpenTool", "打开工具面板", { description: "该功能尚未绑定任何实体键盘按键。" }),
  entry("Celeste", "Jump", "跳跃", { sourceKind: "game", format: "vanilla" }),
  entry("Celeste", "Left", "向左", { sourceKind: "game", format: "vanilla" }),
  entry("Legacy", "Hotkey", "旧式热键", { format: "legacyChord" }),
  entry("DisabledMod", "Action", "禁用功能", { enabled: false }),
];
let buttons: TouchButton[] = [{ id: "missing", label: "保留的按钮", enabled: false, actions: [{ source: "MissingMod", actionPath: "/Gone", format: "standard" }] }];
export async function callRemote(command: string, _path: string, value?: unknown) {
  await new Promise(resolve => setTimeout(resolve, 120));
  if (command === "get_key_bindings") return structuredClone({ entries, touchButtons: buttons });
  if (command === "save_touch_buttons") {
    const next = value as TouchButton[];
    if (next.some(button => button.label === "失败测试")) throw new Error("模拟保存失败：原配置未更改");
    buttons = structuredClone(next); return;
  }
  throw new Error(`Unexpected IPC: ${command}`);
}
