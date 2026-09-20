import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as sass from "sass";

const compile = (relative) =>
  sass
    .compile(fileURLToPath(new URL(relative, import.meta.url)), {
      logger: sass.Logger.silent,
    })
    .css.replace(/\/\*[\s\S]*?\*\//g, "");

// Popup containers are shown by an inline opacity change only, so a residual
// transform on the container is never reset: every dialog renders scaled around
// its own center. Window-filling popups (the crash assistant) then push their
// heading, close button and action buttons outside the viewport, which makes
// the blocking overlay impossible to dismiss.
test("popup containers must not keep a transform", () => {
  const css = compile("../src/index.scss");
  const container = css.match(/^\.popup-container\s*\{([^}]+)\}/m)?.[1];
  assert.ok(container, "compiled CSS must include the popup container");
  assert.doesNotMatch(container, /transform/);
});

// The crash assistant is a non-cancelable overlay, so its footer must stay
// reachable on short windows too.
test("the crash assistant popup scrolls instead of clipping its footer", () => {
  const css = compile("../src/components/CrashAssistant.scss");
  const popup = css.match(
    /^\.popup-content\.crash-assistant-popup\s*\{([^}]+)\}/m,
  )?.[1];
  assert.ok(popup, "compiled CSS must include the crash assistant popup");
  assert.match(popup, /overflow-y:\s*auto/);

  const grid = css.match(/^\.crash-main-grid\s*\{([^}]+)\}/m)?.[1];
  assert.ok(grid, "compiled CSS must include the crash assistant columns");
  assert.doesNotMatch(grid, /min-height:\s*0\b/);
});
