import { useMemo } from "react";
import _i18n from "../i18n";
import { Icon } from "./Icon";
import "./VirtualKeyboard.scss";

export interface VirtualKeyboardBinding {
  actionId: string;
  label: string;
  source: string;
  combination: string;
  keys: string[];
}

interface VirtualKeyboardProps {
  bindings: VirtualKeyboardBinding[];
  selectedKey: string;
  onSelectKey: (key: string) => void;
  formatKey: (key: string) => string;
}

type KeyboardPlatform = "windows" | "macos" | "linux";

interface KeyDefinition {
  value: string;
  label?: string;
  width?: number;
  column?: string;
  row?: string;
}

interface UsageAction {
  actionId: string;
  label: string;
  source: string;
  combinations: Set<string>;
}

const detectKeyboardPlatform = (): KeyboardPlatform => {
  const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (platform.includes("mac")) return "macos";
  if (platform.includes("linux")) return "linux";
  return "windows";
};

const key = (value: string, label?: string, width?: number): KeyDefinition => ({
  value,
  label,
  width,
});

const mainRows = (platform: KeyboardPlatform): KeyDefinition[][] => {
  const meta = platform === "macos" ? "⌘" : platform === "linux" ? "Super" : "Win";
  const alt = platform === "macos" ? "⌥" : "Alt";
  const control = platform === "macos" ? "⌃" : "Ctrl";
  const backspace = platform === "macos" ? "delete" : "Backspace";
  const enter = platform === "macos" ? "return" : "Enter";
  const caps = platform === "macos" ? "caps lock" : "Caps Lock";

  return [
    [
      key("OemTilde", "`"),
      ...Array.from({ length: 10 }, (_, index) => key(`D${(index + 1) % 10}`, String((index + 1) % 10))),
      key("OemMinus", "−"),
      key("OemPlus", "="),
      key("Back", backspace, 2),
    ],
    [
      key("Tab", "Tab", 1.5),
      ..."QWERTYUIOP".split("").map((value) => key(value)),
      key("OemOpenBrackets", "["),
      key("OemCloseBrackets", "]"),
      key("OemPipe", "\\", 1.5),
    ],
    [
      key("CapsLock", caps, 1.8),
      ..."ASDFGHJKL".split("").map((value) => key(value)),
      key("OemSemicolon", ";"),
      key("OemQuotes", "'"),
      key("Enter", enter, 2.2),
    ],
    [
      key("LeftShift", "Shift", 2.3),
      ..."ZXCVBNM".split("").map((value) => key(value)),
      key("OemComma", ","),
      key("OemPeriod", "."),
      key("OemQuestion", "/"),
      key("RightShift", "Shift", 2.7),
    ],
    platform === "macos"
      ? [
          key("LeftControl", control, 1.5),
          key("LeftAlt", alt, 1.5),
          key("LeftWindows", meta, 1.8),
          key("Space", "", 6.4),
          key("RightWindows", meta, 1.8),
          key("RightAlt", alt, 1.5),
          key("RightControl", control, 1.5),
        ]
      : [
          key("LeftControl", control, 1.4),
          key("LeftWindows", meta, 1.4),
          key("LeftAlt", alt, 1.4),
          key("Space", "", 5.4),
          key("RightAlt", alt, 1.4),
          key("RightWindows", meta, 1.4),
          key("Apps", "Menu", 1.3),
          key("RightControl", control, 1.3),
        ],
  ];
};

const navigationRows = (platform: KeyboardPlatform): (KeyDefinition | null)[][] => [
  [
    key(platform === "macos" ? "Help" : "Insert", platform === "macos" ? "help" : "Insert"),
    key("Home"),
    key("PageUp", "Page Up"),
  ],
  [key("Delete"), key("End"), key("PageDown", "Page Down")],
  [null, null, null],
  [null, key("Up", "↑"), null],
  [key("Left", "←"), key("Down", "↓"), key("Right", "→")],
];

const numpadKeys = (platform: KeyboardPlatform): KeyDefinition[] => [
  { ...key("NumLock", platform === "macos" ? "clear" : "Num"), column: "1", row: "1" },
  { ...key("Divide", "/"), column: "2", row: "1" },
  { ...key("Multiply", "×"), column: "3", row: "1" },
  { ...key("Subtract", "−"), column: "4", row: "1" },
  { ...key("NumPad7", "7"), column: "1", row: "2" },
  { ...key("NumPad8", "8"), column: "2", row: "2" },
  { ...key("NumPad9", "9"), column: "3", row: "2" },
  { ...key("Add", "+"), column: "4", row: "2 / span 2" },
  { ...key("NumPad4", "4"), column: "1", row: "3" },
  { ...key("NumPad5", "5"), column: "2", row: "3" },
  { ...key("NumPad6", "6"), column: "3", row: "3" },
  { ...key("NumPad1", "1"), column: "1", row: "4" },
  { ...key("NumPad2", "2"), column: "2", row: "4" },
  { ...key("NumPad3", "3"), column: "3", row: "4" },
  { ...key("Enter", "Enter"), column: "4", row: "4 / span 2" },
  { ...key("NumPad0", "0"), column: "1 / span 2", row: "5" },
  { ...key("Decimal", "."), column: "3", row: "5" },
];

const functionGroups = (platform: KeyboardPlatform): KeyDefinition[][] => [
  [key("Escape", "Esc")],
  ["F1", "F2", "F3", "F4"].map((value) => key(value)),
  ["F5", "F6", "F7", "F8"].map((value) => key(value)),
  ["F9", "F10", "F11", "F12"].map((value) => key(value)),
  (platform === "macos" ? ["F13", "F14", "F15"] : ["PrintScreen", "Scroll", "Pause"]).map(
    (value) => key(value, value === "PrintScreen" ? "Print" : value),
  ),
];

const platformTitle = (platform: KeyboardPlatform) =>
  ({
    windows: _i18n.t("Windows 键盘"),
    macos: _i18n.t("macOS 键盘"),
    linux: _i18n.t("Linux 键盘"),
  })[platform];

export const VirtualKeyboard = ({
  bindings,
  selectedKey,
  onSelectKey,
  formatKey,
}: VirtualKeyboardProps) => {
  const platform = useMemo(detectKeyboardPlatform, []);
  const rows = useMemo(() => mainRows(platform), [platform]);
  const navRows = useMemo(() => navigationRows(platform), [platform]);
  const keypad = useMemo(() => numpadKeys(platform), [platform]);
  const functions = useMemo(() => functionGroups(platform), [platform]);

  const usageByKey = useMemo(() => {
    const result = new Map<string, Map<string, UsageAction>>();
    for (const binding of bindings) {
      for (const value of new Set(binding.keys)) {
        const actions = result.get(value) ?? new Map<string, UsageAction>();
        const action = actions.get(binding.actionId) ?? {
          actionId: binding.actionId,
          label: binding.label,
          source: binding.source,
          combinations: new Set<string>(),
        };
        action.combinations.add(binding.combination);
        actions.set(binding.actionId, action);
        result.set(value, actions);
      }
    }
    return result;
  }, [bindings]);

  const layoutKeys = useMemo(
    () =>
      new Set(
        [
          ...functions.flat(),
          ...rows.flat(),
          ...navRows.flatMap((row) => row.filter((item): item is KeyDefinition => item !== null)),
          ...keypad,
        ].map((item) => item.value),
      ),
    [functions, keypad, navRows, rows],
  );
  const usedLayoutKeys = [...layoutKeys].filter((value) => (usageByKey.get(value)?.size ?? 0) > 0).length;
  const extraKeys = [...usageByKey.keys()]
    .filter((value) => !layoutKeys.has(value))
    .sort((left, right) => left.localeCompare(right));
  const selectedActions = selectedKey ? [...(usageByKey.get(selectedKey)?.values() ?? [])] : [];

  const renderKey = (definition: KeyDefinition, className = "") => {
    const count = usageByKey.get(definition.value)?.size ?? 0;
    const status = count === 0 ? "unused" : count === 1 ? "used" : "multiple";
    const selected = selectedKey === definition.value;
    const label = definition.label ?? formatKey(definition.value);
    const accessibleLabel = label || formatKey(definition.value);
    const usageLabel =
      count === 0
        ? _i18n.t("未使用")
        : _i18n.t("{count} 个功能使用此按键", { count });
    return (
      <button
        type="button"
        className={`virtual-keyboard-key ${status} ${selected ? "selected" : ""} ${className}`}
        key={definition.value}
        style={{
          flex: `${definition.width ?? 1} 1 0`,
          gridColumn: definition.column,
          gridRow: definition.row,
        }}
        title={`${accessibleLabel} · ${usageLabel}`}
        aria-label={`${accessibleLabel} · ${usageLabel}`}
        aria-pressed={selected}
        onClick={() => onSelectKey(selected ? "" : definition.value)}
      >
        <span>{label}</span>
        {count > 0 && <small>{count}</small>}
      </button>
    );
  };

  return (
    <section className="virtual-keyboard-panel" aria-label={_i18n.t("键盘占用")}>
      <header className="virtual-keyboard-header">
        <div>
          <strong>{_i18n.t("键盘占用")}</strong>
          <span className="virtual-keyboard-platform">{platformTitle(platform)}</span>
          <span className="virtual-keyboard-summary">
            {_i18n.t("{used}/{total} 个键已使用", {
              used: usedLayoutKeys,
              total: layoutKeys.size,
            })}
          </span>
        </div>
        <div className="virtual-keyboard-legend" aria-label={_i18n.t("占用状态")}>
          <span className="unused">{_i18n.t("未使用")}</span>
          <span className="used">{_i18n.t("单一占用")}</span>
          <span className="multiple">{_i18n.t("多处占用")}</span>
        </div>
      </header>

      <p className="virtual-keyboard-hint">
        {_i18n.t("点击按键查看占用情况，再次点击取消筛选")}
      </p>

      <div className="virtual-keyboard-scroll">
        <div className="virtual-keyboard-board">
          <div className="virtual-keyboard-function-row">
            {functions.map((group, index) => (
              <div className="virtual-keyboard-function-group" key={index}>
                {group.map((item) => renderKey(item))}
              </div>
            ))}
          </div>
          <div className="virtual-keyboard-body">
            <div className="virtual-keyboard-main">
              {rows.map((row, index) => (
                <div className="virtual-keyboard-row" key={index}>
                  {row.map((item) => renderKey(item))}
                </div>
              ))}
            </div>
            <div className="virtual-keyboard-navigation">
              {navRows.map((row, index) => (
                <div className="virtual-keyboard-row" key={index}>
                  {row.map((item, itemIndex) =>
                    item ? renderKey(item) : <span className="virtual-keyboard-spacer" key={itemIndex} />,
                  )}
                </div>
              ))}
            </div>
            <div className="virtual-keyboard-numpad">{keypad.map((item) => renderKey(item))}</div>
          </div>
        </div>
      </div>

      {extraKeys.length > 0 && (
        <div className="virtual-keyboard-extra">
          <span>{_i18n.t("其它已绑定按键")}</span>
          <div>{extraKeys.map((value) => renderKey(key(value), "extra"))}</div>
        </div>
      )}

      {selectedKey && (
        <div className="virtual-keyboard-detail">
          <div className="virtual-keyboard-detail-title">
            <strong>{formatKey(selectedKey)}</strong>
            <span>
              {selectedActions.length === 0
                ? _i18n.t("没有功能使用此按键")
                : _i18n.t("{count} 个功能使用此按键", { count: selectedActions.length })}
            </span>
            <button
              type="button"
              title={_i18n.t("清除按键筛选")}
              aria-label={_i18n.t("清除按键筛选")}
              onClick={() => onSelectKey("")}
            >
              <Icon name="i-cross" />
            </button>
          </div>
          {selectedActions.length > 0 && (
            <div className="virtual-keyboard-detail-actions">
              {selectedActions.map((action) => (
                <div key={action.actionId}>
                  <strong>{action.label}</strong>
                  <span>{action.source}</span>
                  <code>{[...action.combinations].join(" / ")}</code>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
