import assert from "node:assert/strict";
import test from "node:test";
import { displayException, formatStacktrace } from "./crashTrace";

const ARITHMETIC_EXCEPTION =
  "System.ArithmeticException: Function does not accept floating point Not-a-Number values.";

const breadcrumb = (text: string) =>
  `(09/21/2026 00:44:24) [Everest] [Info] [crit-error-handler] ${text}`;

const crashExcerpt = [
  "(09/21/2026 00:44:24) [Everest] [Error] [crit-error-handler] >>>>>>>>>>>>>>> ENCOUNTERED A CRITICAL ERROR <<<<<<<<<<<<<<<",
  "--------------------------------",
  ARITHMETIC_EXCEPTION,
  "   at System.Math.Sign(Single value)",
  "   at Celeste.MountainRenderer.EaseCamera(Int32 area, MountainCamera transform, Nullable`1 duration, Boolean nearTarget, Boolean targetRotate)",
  "   at Monocle.Engine.RunWithLogging()",
  breadcrumb(
    "Backed up log file to 'C:\\SteamLibrary\\steamapps\\common\\Celeste\\CrashLogs\\log_20260921_004424.txt'",
  ),
  breadcrumb(
    `Created critical error handler for exception ${ARITHMETIC_EXCEPTION}`,
  ),
].join("\n");

test("displayException prefers the logged exception line", () => {
  assert.equal(
    displayException({ excerpt: crashExcerpt, exception: "unused" }),
    ARITHMETIC_EXCEPTION,
  );
});

test("trailing crit-error-handler breadcrumbs never replace the stacktrace", () => {
  const source = { excerpt: crashExcerpt, exception: ARITHMETIC_EXCEPTION };
  const trace = formatStacktrace(source, displayException(source));

  assert.ok(
    !trace.startsWith("Created critical error handler"),
    `the trace must start at the crash frames, got:\n${trace}`,
  );
  assert.match(trace, /at System\.Math\.Sign\(Single value\)/);
  assert.match(trace, /at Monocle\.Engine\.RunWithLogging\(\)/);
  assert.ok(trace.includes("EaseCamera"));
});

test("an excerpt without a crash marker still shows the frames", () => {
  const excerpt = [
    "System.OverflowException: Arithmetic operation resulted in an overflow.",
    "   at Celeste.Mod.SomeMod.SomeHook(Int32 value)",
  ].join("\n");
  const source = { excerpt, exception: "unused" };

  assert.equal(
    displayException(source),
    "System.OverflowException: Arithmetic operation resulted in an overflow.",
  );
  // formatStacktrace trims the joined result, so only the first frame keeps
  // the two-space indentation it re-adds.
  const trace = formatStacktrace(source, displayException(source));
  assert.equal(trace, "at Celeste.Mod.SomeMod.SomeHook(Int32 value)");
});
