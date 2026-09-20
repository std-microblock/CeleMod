import assert from "node:assert/strict";
import { test } from "node:test";
import {
  determinateInstallProgress,
  formatInstallerElapsed,
  parseAndroidInstallerProgress,
} from "./installerProgress";

test("installer stages parse for downloads and local packages", () => {
  const progress = {
    stage: 5,
    total: 7,
    elapsed: 125,
    detail: "[MonoMod] Patch pass",
  };
  for (const step of ["[3/3]", "[2/2]"]) {
    assert.deepEqual(
      parseAndroidInstallerProgress(
        `${step} Run MiniInstaller: Android installer: ${JSON.stringify(progress)}`,
      ),
      progress,
    );
  }
  assert.equal(formatInstallerElapsed(125), "2:05");
  assert.equal(formatInstallerElapsed(0), "0:00");
});
test("malformed progress and unknown stages do not crash the installer view", () => {
  for (const value of [
    null,
    "Run MiniInstaller",
    "Android installer: {",
    "Android installer: null",
    'Android installer: {"stage":8,"total":7,"elapsed":1,"detail":""}',
  ]) {
    assert.equal(parseAndroidInstallerProgress(value), null);
  }
});
test("indeterminate native work is not displayed as a stuck zero percent", () => {
  for (const value of [-1, NaN, Infinity, null, undefined, "50"])
    assert.equal(determinateInstallProgress(value), null);
  assert.equal(determinateInstallProgress(0), 0);
  assert.equal(determinateInstallProgress(42), 42);
  assert.equal(determinateInstallProgress(110), 100);
});
