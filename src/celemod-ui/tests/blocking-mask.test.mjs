import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as sass from "sass";

test("startup spinner continuously rotates instead of only changing opacity", () => {
  const { css } = sass.compile(
    fileURLToPath(new URL("../src/index.scss", import.meta.url)),
    { logger: sass.Logger.silent },
  );
  const spinner = css.match(/^\.blocking-mask-spinner\s*\{([^}]+)\}/m)?.[1];
  assert.ok(spinner, "compiled CSS must include the startup spinner");
  assert.match(spinner, /animation:\s*blocking-mask-spin\s+700ms\s+linear\s+infinite/);

  const frames = css.match(
    /@keyframes blocking-mask-spin\s*\{\s*from\s*\{([^}]+)\}\s*to\s*\{([^}]+)\}\s*\}/,
  );
  assert.ok(frames, "compiled CSS must include the spinner keyframes");
  assert.match(frames[1], /transform:\s*rotate\(0deg\)/);
  assert.match(frames[2], /transform:\s*rotate\(360deg\)/);
});
