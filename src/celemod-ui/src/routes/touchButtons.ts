export interface TouchAction { source: string; actionPath: string; format: string }
export interface TouchButton { id: string; label: string; enabled: boolean; actions: TouchAction[]; icon?: string }
export const TOUCH_ICONS = [
  ["NONE", "文字"], ["CHAT", "聊天"], ["BOLT", "闪电"], ["STAR", "星星"], ["BOOK", "书本"],
  ["KEYBOARD", "键盘"], ["PAUSE", "暂停"], ["PLAY", "播放"], ["CONFIRM", "对勾"], ["BACK", "返回"],
] as const;
export interface TouchEntry extends TouchAction {
  sourceKind: string; action: string; label: string; description?: string;
  enabled: boolean; installed: boolean;
}
export const actionKey = (action: TouchAction) => JSON.stringify([action.source, action.actionPath, action.format]);
const gameActions = new Set(["Jump", "Dash", "Grab", "Talk", "Pause", "Confirm", "Cancel", "Journal", "QuickRestart", "DemoDash"]);
export const supportsTouch = (entry: TouchAction) => entry.format === "standard" ||
  entry.format === "vanilla" && entry.source === "Celeste" && gameActions.has(entry.actionPath.slice(1));
export const toggleTouchAction = (actions: TouchAction[], action: TouchAction): TouchAction[] => {
  const key = actionKey(action);
  return actions.some(item => actionKey(item) === key)
    ? actions.filter(item => actionKey(item) !== key)
    : [...actions, { source: action.source, actionPath: action.actionPath, format: action.format }];
};
export function touchButtonError(button: TouchButton): string {
  if (!button.label.trim() || [...button.label].length > 16 || /[\u0000-\u001f\u007f]/.test(button.label)) return "名称须为 1–16 个可见字符";
  if (!button.actions.length || button.actions.length > 16) return "请选择 1–16 个功能";
  return "";
}
