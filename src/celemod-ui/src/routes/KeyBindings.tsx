import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import _i18n from "../i18n";
import { Icon } from "../components/Icon";
import {
  VirtualKeyboard,
  type VirtualKeyboardBinding,
} from "../components/VirtualKeyboard";
import { createPopup, PopupContext } from "../components/Popup";
import { useCurrentLang, useGamePath } from "../states";
import { callRemote } from "../utils";
import "./KeyBindings.scss";

type Device = "keyboard" | "controller" | "mouse";
type InputMode = "keyboard" | "controller";

interface KeyBindingEntry {
  source: string;
  sourceKind: "game" | "everest" | "mod";
  actionPath: string;
  action: string;
  label: string;
  description?: string;
  format: "vanilla" | "standard" | "legacyChord";
  enabled: boolean;
  installed: boolean;
  keyboard: string[][];
  controller: string[][];
  mouse: string[][];
}

interface KeyBindingCatalog {
  entries: KeyBindingEntry[];
  gameRunning: boolean;
}

interface BindingOccurrence {
  entryKey: string;
  entry: KeyBindingEntry;
  device: Device;
  group: string[];
  groupIndex: number;
  signature: string;
}

interface ConflictGroup {
  signature: string;
  device: Device;
  group: string[];
  occurrences: BindingOccurrence[];
}

const DEVICES: Device[] = ["keyboard", "controller", "mouse"];

const entryKey = (entry: KeyBindingEntry) =>
  `${entry.source}\u0000${entry.actionPath}\u0000${entry.format}`;

const normalizeGroup = (group: string[]) =>
  [...new Set(group.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );

const deviceTitle = (device: Device) =>
  ({
    keyboard: _i18n.t("键盘"),
    controller: _i18n.t("手柄"),
    mouse: _i18n.t("鼠标"),
  })[device];

const keyName = (value: string) => {
  const aliases: Record<string, string> = {
    LeftControl: "Ctrl(L)",
    RightControl: "Ctrl(R)",
    LeftShift: "Shift(L)",
    RightShift: "Shift(R)",
    LeftAlt: "Alt(L)",
    RightAlt: "Alt(R)",
    LeftWindows: "Win(L)",
    RightWindows: "Win(R)",
    OemTilde: "`",
    OemMinus: "-",
    OemPlus: "=",
    OemOpenBrackets: "[",
    OemCloseBrackets: "]",
    OemPipe: "\\",
    OemSemicolon: ";",
    OemQuotes: "'",
    OemComma: ",",
    OemPeriod: ".",
    OemQuestion: "/",
    Back: "Backspace",
    Return: "Enter",
    Capital: "CapsLock",
    Prior: "PageUp",
    Next: "PageDown",
    LeftTrigger: "LT",
    RightTrigger: "RT",
    LeftShoulder: "LB",
    RightShoulder: "RB",
    LeftStick: "L3",
    RightStick: "R3",
    LeftThumbstickLeft: "LS←",
    LeftThumbstickRight: "LS→",
    LeftThumbstickUp: "LS↑",
    LeftThumbstickDown: "LS↓",
    RightThumbstickLeft: "RS←",
    RightThumbstickRight: "RS→",
    RightThumbstickUp: "RS↑",
    RightThumbstickDown: "RS↓",
    XButton1: "Mouse 4",
    XButton2: "Mouse 5",
    Middle: "Mouse Middle",
  };
  if (/^D\d$/.test(value)) return value.slice(1);
  return aliases[value] ?? value;
};

const canonicalKeyboardKey = (value: string) =>
  ({
    Capital: "CapsLock",
    Next: "PageDown",
    Prior: "PageUp",
    Return: "Enter",
  })[value] ?? value;

const keyboardCodeToXna = (code: string) => {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return `D${code.slice(5)}`;
  if (/^Numpad\d$/.test(code)) return `NumPad${code.slice(6)}`;
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(code)) return code;
  const map: Record<string, string> = {
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ControlLeft: "LeftControl",
    ControlRight: "RightControl",
    ShiftLeft: "LeftShift",
    ShiftRight: "RightShift",
    AltLeft: "LeftAlt",
    AltRight: "RightAlt",
    MetaLeft: "LeftWindows",
    MetaRight: "RightWindows",
    Space: "Space",
    Enter: "Enter",
    NumpadEnter: "Enter",
    Tab: "Tab",
    Backspace: "Back",
    Escape: "Escape",
    CapsLock: "CapsLock",
    ScrollLock: "Scroll",
    Pause: "Pause",
    Insert: "Insert",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    NumLock: "NumLock",
    Semicolon: "OemSemicolon",
    Quote: "OemQuotes",
    Backquote: "OemTilde",
    Minus: "OemMinus",
    Equal: "OemPlus",
    BracketLeft: "OemOpenBrackets",
    BracketRight: "OemCloseBrackets",
    Backslash: "OemPipe",
    Comma: "OemComma",
    Period: "OemPeriod",
    Slash: "OemQuestion",
    NumpadAdd: "Add",
    NumpadSubtract: "Subtract",
    NumpadMultiply: "Multiply",
    NumpadDivide: "Divide",
    NumpadDecimal: "Decimal",
  };
  return map[code];
};

const mouseButtonName = (button: number) =>
  ({ 0: "Left", 1: "Middle", 2: "Right", 3: "XButton1", 4: "XButton2" })[
    button
  ];

const GAMEPAD_BUTTONS: Record<number, string> = {
  0: "A",
  1: "B",
  2: "X",
  3: "Y",
  4: "LeftShoulder",
  5: "RightShoulder",
  6: "LeftTrigger",
  7: "RightTrigger",
  8: "Back",
  9: "Start",
  10: "LeftStick",
  11: "RightStick",
  12: "DPadUp",
  13: "DPadDown",
  14: "DPadLeft",
  15: "DPadRight",
};

const gamepadPressed = (gamepad: Gamepad) => {
  const values: string[] = [];
  gamepad.buttons.forEach((button, index) => {
    if (button.pressed && GAMEPAD_BUTTONS[index])
      values.push(GAMEPAD_BUTTONS[index]);
  });
  const axes = gamepad.axes;
  if ((axes[0] ?? 0) < -0.65) values.push("LeftThumbstickLeft");
  if ((axes[0] ?? 0) > 0.65) values.push("LeftThumbstickRight");
  if ((axes[1] ?? 0) < -0.65) values.push("LeftThumbstickUp");
  if ((axes[1] ?? 0) > 0.65) values.push("LeftThumbstickDown");
  if ((axes[2] ?? 0) < -0.65) values.push("RightThumbstickLeft");
  if ((axes[2] ?? 0) > 0.65) values.push("RightThumbstickRight");
  if ((axes[3] ?? 0) < -0.65) values.push("RightThumbstickUp");
  if ((axes[3] ?? 0) > 0.65) values.push("RightThumbstickDown");
  return normalizeGroup(values);
};

const deviceValues = (entry: KeyBindingEntry, device: Device) => entry[device];

const displayLabel = (entry: KeyBindingEntry) =>
  entry.sourceKind === "game"
    ? _i18n.t(`binding_${entry.action}`)
    : entry.label;

export const KeyBindings = () => {
  const [gamePath] = useGamePath();
  const { currentLang } = useCurrentLang();
  const [catalog, setCatalog] = useState<KeyBindingCatalog>({
    entries: [],
    gameRunning: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("*");
  const [conflictOnly, setConflictOnly] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>("keyboard");
  const [selectedConflict, setSelectedConflict] = useState("");
  const [selectedKeyboardKey, setSelectedKeyboardKey] = useState("");
  const [showDisabled, setShowDisabled] = useState(false);
  const [saving, setSaving] = useState("");
  const requestId = useRef(0);

  const refresh = useCallback(() => {
    if (!gamePath) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    void callRemote<KeyBindingCatalog>(
      "get_key_bindings",
      gamePath,
      currentLang,
    )
      .then((data) => {
        if (currentRequest !== requestId.current) return;
        setCatalog(data);
      })
      .catch((reason) => {
        if (currentRequest !== requestId.current) return;
        setError(String(reason));
      })
      .finally(() => {
        if (currentRequest === requestId.current) setLoading(false);
      });
  }, [currentLang, gamePath]);

  useEffect(() => {
    const requestScope = requestId;
    refresh();
    // 卸载时作废旧请求：页面切换中途到达的响应不再写入状态，
    // 下次挂载会以新序号重新加载。
    return () => {
      requestScope.current += 1;
    };
  }, [refresh]);

  const consideredEntries = useMemo(
    () =>
      showDisabled
        ? catalog.entries
        : catalog.entries.filter((entry) => entry.enabled),
    [catalog.entries, showDisabled],
  );
  const disabledCount =
    catalog.entries.length -
    catalog.entries.filter((entry) => entry.enabled).length;

  const occurrences = useMemo(
    () =>
      consideredEntries.flatMap((entry) =>
        DEVICES.flatMap((device) =>
          deviceValues(entry, device)
            .map((group, groupIndex) => {
              const normalized = normalizeGroup(group);
              return {
                entryKey: entryKey(entry),
                entry,
                device,
                group: normalized,
                groupIndex,
                signature: `${device}:${normalized.join("+")}`,
              } satisfies BindingOccurrence;
            })
            .filter((item) => item.group.length > 0),
        ),
      ),
    [consideredEntries],
  );

  const virtualKeyboardBindings = useMemo<VirtualKeyboardBinding[]>(
    () =>
      occurrences
        .filter((occurrence) => occurrence.device === "keyboard")
        .map((occurrence) => ({
          actionId: occurrence.entryKey,
          label: displayLabel(occurrence.entry),
          source: occurrence.entry.source,
          combination: occurrence.group.map(keyName).join(" + "),
          keys: occurrence.group.map(canonicalKeyboardKey),
        })),
    [occurrences],
  );

  const conflictGroups = useMemo<ConflictGroup[]>(() => {
    const grouped = new Map<string, BindingOccurrence[]>();
    for (const occurrence of occurrences) {
      const list = grouped.get(occurrence.signature) ?? [];
      list.push(occurrence);
      grouped.set(occurrence.signature, list);
    }
    return [...grouped.entries()]
      .filter(
        ([, items]) => new Set(items.map((item) => item.entryKey)).size > 1,
      )
      .map(([signature, items]) => ({
        signature,
        device: items[0].device,
        group: items[0].group,
        occurrences: items,
      }))
      .sort(
        (left, right) =>
          right.occurrences.length - left.occurrences.length ||
          left.signature.localeCompare(right.signature),
      );
  }, [occurrences]);

  const activeConflictGroups = useMemo(
    () =>
      conflictGroups.filter((group) =>
        inputMode === "controller"
          ? group.device === "controller"
          : group.device === "keyboard" || group.device === "mouse",
      ),
    [conflictGroups, inputMode],
  );

  useEffect(() => {
    if (!conflictOnly) return;
    if (
      !activeConflictGroups.some(
        (group) => group.signature === selectedConflict,
      )
    ) {
      setSelectedConflict(activeConflictGroups[0]?.signature ?? "");
    }
  }, [activeConflictGroups, conflictOnly, selectedConflict]);

  const conflictsByEntry = useMemo(() => {
    const result = new Map<string, ConflictGroup[]>();
    for (const group of activeConflictGroups) {
      for (const occurrence of group.occurrences) {
        const current = result.get(occurrence.entryKey) ?? [];
        if (!current.includes(group)) current.push(group);
        result.set(occurrence.entryKey, current);
      }
    }
    return result;
  }, [activeConflictGroups]);

  const sources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of consideredEntries)
      counts.set(entry.source, (counts.get(entry.source) ?? 0) + 1);
    return [...counts].sort(([left], [right]) => {
      const order = (value: string) =>
        value === "Celeste" ? 0 : value === "Everest" ? 1 : 2;
      return order(left) - order(right) || left.localeCompare(right);
    });
  }, [consideredEntries]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return consideredEntries.filter((entry) => {
      if (source !== "*" && entry.source !== source) return false;
      if (conflictOnly && !conflictsByEntry.has(entryKey(entry))) return false;
      if (
        selectedKeyboardKey &&
        !entry.keyboard.some((group) =>
          group.some(
            (value) => canonicalKeyboardKey(value) === selectedKeyboardKey,
          ),
        )
      )
        return false;
      if (!normalizedQuery) return true;
      return [
        entry.source,
        displayLabel(entry),
        entry.action,
        entry.description ?? "",
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [
    consideredEntries,
    conflictOnly,
    conflictsByEntry,
    query,
    selectedKeyboardKey,
    source,
  ]);

  const saveEntry = useCallback(
    async (
      entry: KeyBindingEntry,
      next: Partial<Pick<KeyBindingEntry, Device>>,
    ) => {
      const key = entryKey(entry);
      const updated = { ...entry, ...next };
      setSaving(key);
      setError("");
      try {
        await callRemote("update_key_binding", gamePath, {
          source: updated.source,
          actionPath: updated.actionPath,
          format: updated.format,
          keyboard: updated.keyboard,
          controller: updated.controller,
          mouse: updated.mouse,
        });
        setCatalog((current) => ({
          ...current,
          entries: current.entries.map((item) =>
            entryKey(item) === key ? updated : item,
          ),
        }));
        return true;
      } catch (reason) {
        setError(String(reason));
        return false;
      } finally {
        setSaving("");
      }
    },
    [gamePath],
  );

  const beginCapture = (
    entry: KeyBindingEntry,
    device: Device,
    replaceIndex?: number,
  ) => {
    const CapturePopup = () => {
      const popup = useContext(PopupContext);
      const [captured, setCaptured] = useState<string[]>([]);
      const capturedRef = useRef<string[]>([]);
      const updateCaptured = (values: string[]) => {
        const next = normalizeGroup(values);
        capturedRef.current = next;
        setCaptured(next);
      };
      const commit = useCallback(
        async (values = capturedRef.current) => {
          if (values.length === 0) return;
          const current = deviceValues(entry, device);
          let groups: string[][];
          if (entry.format === "legacyChord") {
            groups = [normalizeGroup(values)];
          } else {
            const value = values[0];
            groups =
              replaceIndex === undefined
                ? [...current, [value]]
                : current.map((group, index) =>
                    index === replaceIndex ? [value] : group,
                  );
            groups = groups.filter(
              (group, index) =>
                groups.findIndex((item) => item[0] === group[0]) === index,
            );
          }
          if (await saveEntry(entry, { [device]: groups })) popup.hide();
        },
        [popup],
      );

      useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.code === "Escape") {
            event.preventDefault();
            popup.hide();
            return;
          }
          if (device !== "keyboard") return;
          event.preventDefault();
          event.stopPropagation();
          const value = keyboardCodeToXna(event.code);
          if (!value) return;
          if (entry.format === "legacyChord")
            updateCaptured([...capturedRef.current, value]);
          else void commit([value]);
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
      }, [commit, popup]);

      useEffect(() => {
        if (device !== "controller") return;
        let frame = 0;
        let previous = new Set<string>();
        const poll = () => {
          const gamepad = [...(navigator.getGamepads?.() ?? [])].find(Boolean);
          const pressed = gamepad ? gamepadPressed(gamepad) : [];
          const newlyPressed = pressed.filter((value) => !previous.has(value));
          if (newlyPressed.length > 0) {
            if (entry.format === "legacyChord")
              updateCaptured([...capturedRef.current, ...newlyPressed]);
            else void commit([newlyPressed[0]]);
          }
          previous = new Set(pressed);
          frame = requestAnimationFrame(poll);
        };
        frame = requestAnimationFrame(poll);
        return () => cancelAnimationFrame(frame);
      }, [commit]);

      return (
        <div
          className="binding-capture-popup"
          onContextMenu={(event) => event.preventDefault()}
          onMouseDown={(event) => {
            if (device !== "mouse") return;
            event.preventDefault();
            const value = mouseButtonName(event.button);
            if (value) void commit([value]);
          }}
        >
          <Icon name={device === "controller" ? "gamepad" : "keyboard"} />
          <strong>
            {device === "keyboard"
              ? _i18n.t("请按下新的键盘按键")
              : device === "controller"
                ? _i18n.t("请按下手柄按键")
                : _i18n.t("请点击鼠标按键")}
          </strong>
          <span>
            {captured.length > 0
              ? captured.map(keyName).join(" + ")
              : _i18n.t("Esc 取消")}
          </span>
          {entry.format === "legacyChord" && (
            <button
              disabled={captured.length === 0}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void commit()}
            >
              {_i18n.t("保存组合")}
            </button>
          )}
          <button
            className="capture-cancel"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={popup.hide}
          >
            <Icon name="i-cross" />
          </button>
        </div>
      );
    };
    createPopup(CapturePopup, {
      cancelable: false,
      backgroundMask: "rgba(0, 0, 0, 0.82)",
      className: "binding-capture-overlay",
    });
  };

  const removeBinding = (
    entry: KeyBindingEntry,
    device: Device,
    index: number,
  ) => {
    const groups = deviceValues(entry, device).filter(
      (_, groupIndex) => groupIndex !== index,
    );
    void saveEntry(entry, { [device]: groups });
  };

  const visibleDevices: Device[] =
    inputMode === "controller" ? ["controller"] : ["keyboard", "mouse"];

  const renderDevices = (entry: KeyBindingEntry) => (
    <div className="binding-devices">
      {visibleDevices.map((device) => {
        if (entry.format === "legacyChord" && device === "mouse") return null;
        const groups = deviceValues(entry, device);
        return (
          <div
            className={`binding-device binding-device-${device}`}
            key={device}
          >
            <span className="device-name">{deviceTitle(device)}</span>
            <div className="binding-values">
              {groups.map((group, index) => (
                <button
                  type="button"
                  className="binding-chip"
                  key={`${group.join("+")}-${index}`}
                  disabled={catalog.gameRunning || saving === entryKey(entry)}
                  title={_i18n.t("点击重新绑定；使用右侧按钮移除")}
                  onClick={() => beginCapture(entry, device, index)}
                >
                  {group.map(keyName).join(" + ")}
                  <span
                    onClick={(event) => {
                      event.stopPropagation();
                      removeBinding(entry, device, index);
                    }}
                  >
                    <Icon name="i-cross" />
                  </span>
                </button>
              ))}
              <button
                type="button"
                className="binding-add"
                disabled={catalog.gameRunning || saving === entryKey(entry)}
                onClick={() => beginCapture(entry, device)}
              >
                +
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderRow = (entry: KeyBindingEntry, compactSource = false) => {
    const conflicts = conflictsByEntry.get(entryKey(entry)) ?? [];
    return (
      <div
        className={`binding-row ${entry.enabled ? "" : "disabled"}`}
        key={entryKey(entry)}
      >
        <div className="binding-info">
          <div className="binding-title-line">
            <strong>{displayLabel(entry)}</strong>
            {!compactSource && (
              <span className="binding-source">{entry.source}</span>
            )}
            {conflicts.length > 0 && (
              <span className="conflict-badge">
                <Icon name="warn" />
                {conflicts.length}
              </span>
            )}
            {!entry.enabled && (
              <span className="disabled-badge">{_i18n.t("未启用")}</span>
            )}
          </div>
          {entry.description && <p>{entry.description}</p>}
          <small>{entry.action}</small>
        </div>
        {renderDevices(entry)}
      </div>
    );
  };

  const visibleConflictGroups = useMemo(
    () =>
      activeConflictGroups
        .map((group) => ({
          ...group,
          occurrences: group.occurrences.filter((occurrence) => {
            const entry = occurrence.entry;
            const normalizedQuery = query.trim().toLocaleLowerCase();
            return (
              !normalizedQuery ||
              [
                entry.source,
                displayLabel(entry),
                entry.action,
                entry.description ?? "",
              ].some((value) =>
                value.toLocaleLowerCase().includes(normalizedQuery),
              )
            );
          }),
        }))
        .filter((group) => group.occurrences.length > 0),
    [activeConflictGroups, query],
  );

  const selectedConflictGroup =
    visibleConflictGroups.find(
      (group) => group.signature === selectedConflict,
    ) ?? visibleConflictGroups[0];

  return (
    <div className="keybindings-page">
      <aside className="keybindings-sources">
        {conflictOnly ? (
          <>
            <div className="source-heading">{_i18n.t("冲突按键")}</div>
            {visibleConflictGroups.map((group) => (
              <button
                key={group.signature}
                className={
                  selectedConflictGroup?.signature === group.signature
                    ? "selected conflict-source"
                    : "conflict-source"
                }
                onClick={() => setSelectedConflict(group.signature)}
              >
                <span>
                  <small>{deviceTitle(group.device)}</small>
                  {group.group.map(keyName).join(" + ")}
                </span>
                <small>{group.occurrences.length}</small>
              </button>
            ))}
          </>
        ) : (
          <>
            <div className="source-heading">{_i18n.t("来源")}</div>
            <button
              className={source === "*" ? "selected" : ""}
              onClick={() => setSource("*")}
            >
              <span>{_i18n.t("全部")}</span>
              <small>{consideredEntries.length}</small>
            </button>
            {sources.map(([name, count]) => (
              <button
                key={name}
                className={source === name ? "selected" : ""}
                onClick={() => setSource(name)}
              >
                <span>{name}</span>
                <small>{count}</small>
              </button>
            ))}
          </>
        )}
      </aside>

      <section className="keybindings-main">
        <header className="keybindings-toolbar">
          <div className="keybindings-title">
            <h1>{_i18n.t("按键")}</h1>
            <span>
              {_i18n.t("{count} 个按键功能", {
                count: consideredEntries.length,
              })}
            </span>
          </div>
          <div className="keybindings-search">
            <Icon name="search" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={_i18n.t("搜索功能或 Mod…")}
            />
            {query && (
              <button onClick={() => setQuery("")}>
                <Icon name="i-cross" />
              </button>
            )}
          </div>
          <div className="keybindings-actions">
            <div className="input-mode-switch">
              <button
                className={inputMode === "keyboard" ? "selected" : ""}
                onClick={() => setInputMode("keyboard")}
              >
                <Icon name="keyboard" />
                {_i18n.t("键鼠")}
              </button>
              <button
                className={inputMode === "controller" ? "selected" : ""}
                onClick={() => {
                  setInputMode("controller");
                  setSelectedKeyboardKey("");
                }}
              >
                <Icon name="gamepad" />
                {_i18n.t("手柄")}
              </button>
            </div>
            {disabledCount > 0 && (
              <button
                className={`disabled-toggle ${showDisabled ? "selected" : ""}`}
                onClick={() => setShowDisabled(!showDisabled)}
                title={
                  showDisabled
                    ? _i18n.t("隐藏未启用的 Mod")
                    : _i18n.t("显示未启用的 Mod")
                }
              >
                <Icon name="eye" />
                <span>{disabledCount}</span>
              </button>
            )}
            <button
              className={`conflict-toggle ${conflictOnly ? "selected" : ""}`}
              onClick={() => {
                const next = !conflictOnly;
                setConflictOnly(next);
                if (next) setSelectedKeyboardKey("");
              }}
              title={_i18n.t("冲突")}
            >
              <Icon name="warn" />
              <span>{activeConflictGroups.length}</span>
            </button>
          </div>
        </header>

        {catalog.gameRunning && (
          <div className="keybindings-warning">
            <Icon name="warn" />
            {_i18n.t(
              "Celeste 正在运行，目前只能查看按键。退出游戏后即可编辑。",
            )}
          </div>
        )}
        {error && (
          <div className="keybindings-error">
            <Icon name="fail" />
            <span>{error}</span>
            <button onClick={() => setError("")}>
              <Icon name="i-cross" />
            </button>
          </div>
        )}

        <div className="keybindings-scroll">
          {!loading && inputMode === "keyboard" && !conflictOnly && (
            <VirtualKeyboard
              bindings={virtualKeyboardBindings}
              selectedKey={selectedKeyboardKey}
              onSelectKey={setSelectedKeyboardKey}
              formatKey={keyName}
            />
          )}
          {loading ? (
            <div className="keybindings-empty">
              {_i18n.t("正在读取按键配置…")}
            </div>
          ) : conflictOnly ? (
            selectedConflictGroup ? (
              <section className="conflict-detail">
                <div className="conflict-detail-heading">
                  <div>
                    <span>{deviceTitle(selectedConflictGroup.device)}</span>
                    <strong>
                      {selectedConflictGroup.group.map(keyName).join(" + ")}
                    </strong>
                  </div>
                  <small>{_i18n.t("此按键同时被以下功能使用")}</small>
                </div>
                {selectedConflictGroup.occurrences.map((occurrence) => (
                  <div
                    className={`conflict-action-row ${
                      occurrence.entry.enabled ? "" : "disabled"
                    }`}
                    key={`${occurrence.entryKey}-${occurrence.groupIndex}`}
                  >
                    <div>
                      <strong>{displayLabel(occurrence.entry)}</strong>
                      <span>{occurrence.entry.source}</span>
                      {occurrence.entry.description && (
                        <p>{occurrence.entry.description}</p>
                      )}
                    </div>
                    <div className="conflict-actions">
                      <button
                        disabled={
                          catalog.gameRunning || saving === occurrence.entryKey
                        }
                        onClick={() =>
                          beginCapture(
                            occurrence.entry,
                            occurrence.device,
                            occurrence.groupIndex,
                          )
                        }
                      >
                        <Icon
                          name={
                            occurrence.device === "controller"
                              ? "gamepad"
                              : "keyboard"
                          }
                        />
                        {_i18n.t("重新录制")}
                      </button>
                      <button
                        className="clear-binding"
                        disabled={
                          catalog.gameRunning || saving === occurrence.entryKey
                        }
                        onClick={() =>
                          removeBinding(
                            occurrence.entry,
                            occurrence.device,
                            occurrence.groupIndex,
                          )
                        }
                      >
                        <Icon name="i-cross" />
                        {_i18n.t("清除绑定")}
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            ) : (
              <div className="keybindings-empty">
                <Icon name="i-tick" />
                <strong>{_i18n.t("没有发现相同按键冲突")}</strong>
              </div>
            )
          ) : filteredEntries.length > 0 ? (
            filteredEntries.map((entry) => renderRow(entry, source !== "*"))
          ) : (
            <div className="keybindings-empty">
              <Icon name="search" />
              <strong>{_i18n.t("没有符合条件的按键")}</strong>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
