import { useEffect, useMemo, useState } from "react";
import _i18n from "../i18n";
import { Icon } from "./Icon";
import xboxSeriesController from "../resources/controllers/xbox-series.png";
import dualSenseController from "../resources/controllers/dualsense.png";
import switchProController from "../resources/controllers/switch-pro.svg";
import "./VirtualController.scss";

export interface VirtualControllerBinding {
  actionId: string;
  label: string;
  source: string;
  combination: string;
  buttons: string[];
}

interface VirtualControllerProps {
  bindings: VirtualControllerBinding[];
  selectedButton: string;
  onSelectButton: (button: string) => void;
  formatButton: (button: string) => string;
}

type ControllerLayout = "xbox" | "playstation" | "switch";

// Controller diagrams are CC0 assets by Xelu, distributed by
// https://github.com/rsubtil/controller_icons.
const controllerImages: Record<ControllerLayout, string> = {
  xbox: xboxSeriesController,
  playstation: dualSenseController,
  switch: switchProController,
};

interface ControllerIdentity {
  connected: boolean;
  id: string;
  layout: ControllerLayout;
}

interface UsageAction {
  actionId: string;
  label: string;
  source: string;
  combinations: Set<string>;
}

type LayoutPreference = "auto" | ControllerLayout;
type ControlKind = "direction" | "dpad" | "face" | "menu" | "pill" | "stick";

interface ControlPosition {
  value: string;
  x: number;
  y: number;
  kind: ControlKind;
}

interface StickPosition {
  x: number;
  y: number;
}

const CONTROLLER_BUTTONS = [
  "A",
  "B",
  "X",
  "Y",
  "LeftShoulder",
  "RightShoulder",
  "LeftTrigger",
  "RightTrigger",
  "Back",
  "Start",
  "LeftStick",
  "RightStick",
  "DPadUp",
  "DPadDown",
  "DPadLeft",
  "DPadRight",
  "LeftThumbstickUp",
  "LeftThumbstickDown",
  "LeftThumbstickLeft",
  "LeftThumbstickRight",
  "RightThumbstickUp",
  "RightThumbstickDown",
  "RightThumbstickLeft",
  "RightThumbstickRight",
] as const;

const detectControllerLayout = (id: string): ControllerLayout => {
  const normalized = id.toLocaleLowerCase();
  if (
    normalized.includes("dualsense") ||
    normalized.includes("dualshock") ||
    normalized.includes("playstation") ||
    normalized.includes("sony") ||
    normalized.includes("wireless controller")
  )
    return "playstation";
  if (
    normalized.includes("nintendo") ||
    normalized.includes("switch") ||
    normalized.includes("joy-con")
  )
    return "switch";
  return "xbox";
};

const readControllerIdentity = (): ControllerIdentity => {
  const gamepad = [...(navigator.getGamepads?.() ?? [])].find(Boolean);
  return gamepad
    ? {
        connected: true,
        id: gamepad.id,
        layout: detectControllerLayout(gamepad.id),
      }
    : { connected: false, id: "", layout: "xbox" };
};

const layoutTitle = (layout: ControllerLayout) =>
  ({
    xbox: _i18n.t("Xbox 布局"),
    playstation: _i18n.t("PlayStation 布局"),
    switch: _i18n.t("Switch 布局"),
  })[layout];

const buttonLabels: Record<ControllerLayout, Record<string, string>> = {
  xbox: {
    A: "A",
    B: "B",
    X: "X",
    Y: "Y",
    LeftShoulder: "LB",
    RightShoulder: "RB",
    LeftTrigger: "LT",
    RightTrigger: "RT",
    Back: "View",
    Start: "Menu",
    LeftStick: "L3",
    RightStick: "R3",
  },
  playstation: {
    A: "×",
    B: "○",
    X: "□",
    Y: "△",
    LeftShoulder: "L1",
    RightShoulder: "R1",
    LeftTrigger: "L2",
    RightTrigger: "R2",
    Back: "Create",
    Start: "Options",
    LeftStick: "L3",
    RightStick: "R3",
  },
  switch: {
    A: "B",
    B: "A",
    X: "Y",
    Y: "X",
    LeftShoulder: "L",
    RightShoulder: "R",
    LeftTrigger: "ZL",
    RightTrigger: "ZR",
    Back: "−",
    Start: "+",
    LeftStick: "L",
    RightStick: "R",
  },
};

const fixedLabels: Record<string, string> = {
  DPadUp: "↑",
  DPadDown: "↓",
  DPadLeft: "←",
  DPadRight: "→",
  LeftThumbstickUp: "↑",
  LeftThumbstickDown: "↓",
  LeftThumbstickLeft: "←",
  LeftThumbstickRight: "→",
  RightThumbstickUp: "↑",
  RightThumbstickDown: "↓",
  RightThumbstickLeft: "←",
  RightThumbstickRight: "→",
};

const control = (
  value: string,
  x: number,
  y: number,
  kind: ControlKind,
): ControlPosition => ({ value, x, y, kind });

const dpadControls = (
  x: number,
  y: number,
  horizontalOffset: number,
  verticalOffset: number,
): ControlPosition[] => [
  control("DPadUp", x, y - verticalOffset, "dpad"),
  control("DPadLeft", x - horizontalOffset, y, "dpad"),
  control("DPadRight", x + horizontalOffset, y, "dpad"),
  control("DPadDown", x, y + verticalOffset, "dpad"),
];

const faceControls = (
  x: number,
  y: number,
  horizontalOffset: number,
  verticalOffset: number,
): ControlPosition[] => [
  control("Y", x, y - verticalOffset, "face"),
  control("X", x - horizontalOffset, y, "face"),
  control("B", x + horizontalOffset, y, "face"),
  control("A", x, y + verticalOffset, "face"),
];

const controllerPositions: Record<ControllerLayout, ControlPosition[]> = {
  xbox: [
    control("LeftTrigger", 25, 5, "pill"),
    control("RightTrigger", 75, 5, "pill"),
    control("LeftShoulder", 24, 17, "pill"),
    control("RightShoulder", 76, 17, "pill"),
    control("Back", 44, 43, "menu"),
    control("Start", 58, 43, "menu"),
    ...dpadControls(38, 65, 3.8, 5.6),
    ...faceControls(76, 42.5, 6.5, 9),
  ],
  playstation: [
    control("LeftTrigger", 21, 8, "pill"),
    control("RightTrigger", 79, 8, "pill"),
    control("LeftShoulder", 21, 18, "pill"),
    control("RightShoulder", 79, 18, "pill"),
    control("Back", 28, 32, "menu"),
    control("Start", 73, 32, "menu"),
    ...dpadControls(21, 47, 4.3, 6),
    ...faceControls(80, 47, 6.5, 10.5),
  ],
  switch: [
    control("LeftTrigger", 21.7, 8.4, "pill"),
    control("RightTrigger", 76, 8.4, "pill"),
    control("LeftShoulder", 21.6, 21.7, "pill"),
    control("RightShoulder", 76, 21.7, "pill"),
    control("Back", 36.6, 32.4, "menu"),
    control("Start", 61, 32.4, "menu"),
    ...dpadControls(33.8, 58.3, 4.6, 5.7),
    ...faceControls(74.6, 41.6, 7.6, 8.2),
  ],
};

const controllerStickPositions: Record<
  ControllerLayout,
  Record<"Left" | "Right", StickPosition>
> = {
  xbox: {
    Left: { x: 26, y: 44 },
    Right: { x: 64, y: 65 },
  },
  playstation: {
    Left: { x: 36, y: 68 },
    Right: { x: 65, y: 68 },
  },
  switch: {
    Left: { x: 21.9, y: 41.8 },
    Right: { x: 61.7, y: 58.2 },
  },
};

const shortLayoutTitle = (layout: ControllerLayout) =>
  ({ xbox: "Xbox", playstation: "PS", switch: "Switch" })[layout];

const stickPoint = (radius: number, degrees: number) => {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: 50 + radius * Math.cos(radians),
    y: 50 + radius * Math.sin(radians),
  };
};

const stickSegmentPath = (start: number, end: number) => {
  const outerStart = stickPoint(47, start);
  const outerEnd = stickPoint(47, end);
  const innerEnd = stickPoint(27, end);
  const innerStart = stickPoint(27, start);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A 47 47 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A 27 27 0 0 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
};

const STICK_SEGMENTS = [
  { suffix: "Up", label: "↑", start: -132, end: -48, x: 50, y: 17 },
  { suffix: "Right", label: "→", start: -42, end: 42, x: 83, y: 53 },
  { suffix: "Down", label: "↓", start: 48, end: 132, x: 50, y: 88 },
  { suffix: "Left", label: "←", start: 138, end: 222, x: 17, y: 53 },
] as const;

export const VirtualController = ({
  bindings,
  selectedButton,
  onSelectButton,
  formatButton,
}: VirtualControllerProps) => {
  const [identity, setIdentity] = useState(readControllerIdentity);
  const [layoutPreference, setLayoutPreference] =
    useState<LayoutPreference>("auto");
  const layout =
    layoutPreference === "auto" ? identity.layout : layoutPreference;

  useEffect(() => {
    const updateIdentity = () => setIdentity(readControllerIdentity());
    window.addEventListener("gamepadconnected", updateIdentity);
    window.addEventListener("gamepaddisconnected", updateIdentity);
    return () => {
      window.removeEventListener("gamepadconnected", updateIdentity);
      window.removeEventListener("gamepaddisconnected", updateIdentity);
    };
  }, []);

  const usageByButton = useMemo(() => {
    const result = new Map<string, Map<string, UsageAction>>();
    for (const binding of bindings) {
      for (const value of new Set(binding.buttons)) {
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

  const usedButtons = CONTROLLER_BUTTONS.filter(
    (value) => (usageByButton.get(value)?.size ?? 0) > 0,
  ).length;
  const extraButtons = [...usageByButton.keys()]
    .filter(
      (value) => !(CONTROLLER_BUTTONS as readonly string[]).includes(value),
    )
    .sort((left, right) => left.localeCompare(right));
  const selectedActions = selectedButton
    ? [...(usageByButton.get(selectedButton)?.values() ?? [])]
    : [];

  const displayLabel = (value: string) =>
    fixedLabels[value] ?? buttonLabels[layout][value] ?? formatButton(value);

  const buttonPresentation = (value: string) => {
    const count = usageByButton.get(value)?.size ?? 0;
    const status = count === 0 ? "unused" : count === 1 ? "used" : "multiple";
    const selected = value === selectedButton;
    const label = displayLabel(value);
    const logicalName = formatButton(value);
    const accessibleLabel =
      label === logicalName ? label : `${label} (${logicalName})`;
    const usageLabel =
      count === 0
        ? _i18n.t("未使用")
        : _i18n.t("{count} 个功能使用此按键", { count });
    return {
      accessibleLabel,
      count,
      label,
      selected,
      status,
      usageLabel,
    };
  };

  const renderButton = (
    value: string,
    className = "",
    position?: Pick<ControlPosition, "x" | "y">,
  ) => {
    const { accessibleLabel, count, label, selected, status, usageLabel } =
      buttonPresentation(value);
    return (
      <button
        type="button"
        className={`virtual-controller-button ${status} ${selected ? "selected" : ""} ${className}`}
        key={value}
        title={`${accessibleLabel} · ${usageLabel}`}
        aria-label={`${accessibleLabel} · ${usageLabel}`}
        aria-pressed={selected}
        onClick={() => onSelectButton(selected ? "" : value)}
        style={
          position
            ? { left: `${position.x}%`, top: `${position.y}%` }
            : undefined
        }
      >
        <span>{label}</span>
        {count > 0 && <small>{count}</small>}
      </button>
    );
  };

  const renderStick = (side: "Left" | "Right", position: StickPosition) => (
    <div
      className="virtual-controller-stick-control"
      key={`${side}Stick`}
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
    >
      <svg viewBox="0 0 100 100">
        {STICK_SEGMENTS.map((segment) => {
          const value = `${side}Thumbstick${segment.suffix}`;
          const { accessibleLabel, count, selected, status, usageLabel } =
            buttonPresentation(value);
          const select = () => onSelectButton(selected ? "" : value);
          const badgeX =
            segment.x < 50
              ? segment.x + 8
              : segment.x > 50
                ? segment.x - 8
                : segment.x + 9;
          return (
            <g key={value}>
              <path
                className={`stick-segment ${status} ${selected ? "selected" : ""}`}
                d={stickSegmentPath(segment.start, segment.end)}
                role="button"
                tabIndex={0}
                aria-label={`${accessibleLabel} · ${usageLabel}`}
                aria-pressed={selected}
                onClick={select}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  select();
                }}
              >
                <title>{`${accessibleLabel} · ${usageLabel}`}</title>
              </path>
              <text className="stick-segment-label" x={segment.x} y={segment.y}>
                {segment.label}
              </text>
              {count > 0 && (
                <text
                  className={`stick-segment-count ${status}`}
                  x={badgeX}
                  y={segment.y - 7}
                >
                  {count}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {renderButton(`${side}Stick`, "stick")}
    </div>
  );

  return (
    <section
      className="virtual-controller-panel"
      aria-label={_i18n.t("手柄占用")}
    >
      <header className="virtual-controller-header">
        <div className="virtual-controller-heading">
          <strong>{_i18n.t("手柄占用")}</strong>
          <div
            className="virtual-controller-layout-switch"
            role="group"
            aria-label={_i18n.t("手柄布局")}
          >
            {(["auto", "xbox", "playstation", "switch"] as const).map(
              (option) => (
                <button
                  type="button"
                  className={layoutPreference === option ? "selected" : ""}
                  key={option}
                  title={
                    option === "auto"
                      ? _i18n.t("跟随已连接手柄")
                      : layoutTitle(option)
                  }
                  aria-pressed={layoutPreference === option}
                  onClick={() => setLayoutPreference(option)}
                >
                  {option === "auto"
                    ? `${_i18n.t("自动")} · ${shortLayoutTitle(layout)}`
                    : shortLayoutTitle(option)}
                </button>
              ),
            )}
          </div>
          <span
            className={`virtual-controller-connection ${identity.connected ? "connected" : ""}`}
            title={identity.id}
          >
            {identity.connected ? _i18n.t("已连接") : _i18n.t("未检测到手柄")}
          </span>
          <span className="virtual-controller-summary">
            {_i18n.t("{used}/{total} 个按钮已使用", {
              used: usedButtons,
              total: CONTROLLER_BUTTONS.length,
            })}
          </span>
        </div>
        <div
          className="virtual-controller-legend"
          aria-label={_i18n.t("占用状态")}
        >
          <span className="unused">{_i18n.t("未使用")}</span>
          <span className="used">{_i18n.t("单一占用")}</span>
          <span className="multiple">{_i18n.t("多处占用")}</span>
        </div>
      </header>

      <p className="virtual-controller-hint">
        {_i18n.t("点击手柄按键查看占用情况，再次点击取消筛选")}
      </p>

      <div className="virtual-controller-scroll">
        <div className={`virtual-controller-diagram ${layout}`}>
          <img
            className="virtual-controller-image"
            src={controllerImages[layout]}
            alt=""
            draggable={false}
            aria-hidden="true"
          />
          {controllerPositions[layout].map((position) =>
            renderButton(position.value, position.kind, position),
          )}
          {renderStick("Left", controllerStickPositions[layout].Left)}
          {renderStick("Right", controllerStickPositions[layout].Right)}
        </div>
      </div>

      {extraButtons.length > 0 && (
        <div className="virtual-controller-extra">
          <span>{_i18n.t("其它已绑定按钮")}</span>
          <div>{extraButtons.map((value) => renderButton(value, "extra"))}</div>
        </div>
      )}

      {selectedButton && (
        <div className="virtual-controller-detail">
          <div className="virtual-controller-detail-title">
            <strong>{displayLabel(selectedButton)}</strong>
            <span>
              {selectedActions.length === 0
                ? _i18n.t("没有功能使用此按键")
                : _i18n.t("{count} 个功能使用此按键", {
                    count: selectedActions.length,
                  })}
            </span>
            <button
              type="button"
              title={_i18n.t("清除手柄筛选")}
              aria-label={_i18n.t("清除手柄筛选")}
              onClick={() => onSelectButton("")}
            >
              <Icon name="i-cross" />
            </button>
          </div>
          {selectedActions.length > 0 && (
            <div className="virtual-controller-detail-actions">
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
