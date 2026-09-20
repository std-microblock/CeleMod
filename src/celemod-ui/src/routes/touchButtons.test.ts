import assert from "node:assert/strict";
import test from "node:test";
import {
  actionKey,
  supportsTouch,
  toggleTouchAction,
  touchButtonError,
  TOUCH_ICONS,
} from "./touchButtons";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { TouchButtonIcon } from "./TouchButtonIcon";

const chat = {
  source: "MiaoNet",
  actionPath: "/ChatButton",
  format: "standard",
};
const tool = { source: "Tools", actionPath: "/ChatButton", format: "standard" };
test("selection identifies source/path/format, supports multiple actions, and never changes the original", () => {
  const original = [chat];
  const combo = toggleTouchAction(original, tool);
  assert.equal(combo.length, 2);
  assert.equal(original.length, 1);
  assert.deepEqual(toggleTouchAction(combo, chat), [tool]);
  assert.notEqual(actionKey(chat), actionKey(tool));
});
test("supported actions do not require physical key bindings", () => {
  assert.ok(supportsTouch(chat));
  assert.ok(
    supportsTouch({
      source: "Celeste",
      actionPath: "/Jump",
      format: "vanilla",
    }),
  );
  assert.ok(!supportsTouch({ ...chat, format: "legacyChord" }));
  assert.ok(
    !supportsTouch({
      source: "Celeste",
      actionPath: "/Left",
      format: "vanilla",
    }),
  );
});
test("button validation rejects empty labels/actions and excessive groups", () => {
  const button = { id: "one", label: "聊天", enabled: true, actions: [chat] };
  assert.equal(touchButtonError(button), "");
  for (const change of [
    { label: " " },
    { label: "a".repeat(17) },
    { label: "bad\nname" },
    { actions: [] },
    { actions: Array(17).fill(chat) },
  ])
    assert.ok(touchButtonError({ ...button, ...change }));
});
test("all selectable icons render a preview, with backwards-compatible text fallback", () => {
  for (const [icon] of TOUCH_ICONS) {
    const html = renderToStaticMarkup(
      createElement(TouchButtonIcon, { icon, label: "Test" }),
    );
    assert.ok(html.includes(icon === "NONE" ? "Test" : "<svg"), icon);
  }
  assert.ok(
    renderToStaticMarkup(
      createElement(TouchButtonIcon, { label: "Old" }),
    ).includes("Old"),
  );
});
