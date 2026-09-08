import assert from "node:assert/strict";
import test from "node:test";
import { steamActivity, steamIssue, steamProgress, steamScreen, type SteamStatus } from "./steamState";

const idle: SteamStatus = { account: "", steamId: "", busy: false, cloud: true, offline: false, pending: false };
test("logged-out entry opens login, not settings or a fake connected state", () => {
  assert.equal(steamScreen(undefined, "main"), "loading");
  assert.equal(steamScreen(idle, "main"), "login");
  assert.equal(steamScreen({ ...idle, stage: "signed-out" }, "main"), "login");
  assert.equal(steamScreen(idle, "settings"), "login");
});
test("Steam Guard and transfers replace forms, even for recovered jobs", () => {
  for (const panel of ["main", "login", "settings"] as const) {
    assert.equal(steamScreen({ ...idle, busy: true, stage: "guard-confirm" }, panel), "approval");
    for (const stage of ["guard-device", "guard-email"])
      assert.equal(steamScreen({ ...idle, busy: true, stage }, panel), "code");
    for (const stage of ["connecting", "authenticating", "manifest", "downloading", "syncing"])
      assert.equal(steamScreen({ ...idle, busy: true, stage }, panel), "progress");
  }
});
test("conflict is persistent but allows explicit confirmation and account settings", () => {
  const conflict = { ...idle, account: "test", stage: "conflict" };
  assert.equal(steamScreen(conflict, "main"), "conflict");
  assert.equal(steamScreen(conflict, "local"), "local");
  assert.equal(steamScreen(conflict, "cloud"), "cloud");
  assert.equal(steamScreen(conflict, "settings"), "settings");
});
test("cancelled/interrupted jobs do not leave a disabled busy form", () => {
  for (const stage of ["cancelled", "interrupted", "error"])
    assert.equal(steamScreen({ ...idle, stage }, "main"), "login");
  assert.equal(steamScreen({ ...idle, account: "test", stage: "cancelled" }, "main"), "overview");
  assert.equal(steamScreen({ ...idle, account: "test", operation: "login", stage: "error" }, "main"), "login");
});
test("progress is indeterminate without a total, and bounded when measured", () => {
  assert.equal(steamProgress(undefined), undefined);
  assert.equal(steamProgress({ ...idle, total: 0 }), undefined);
  assert.equal(steamProgress({ ...idle, total: -1 }), undefined);
  assert.equal(steamProgress({ ...idle, total: 100, done: -10 }), 0);
  assert.equal(steamProgress({ ...idle, total: 100, done: 40 }), 40);
  assert.equal(steamProgress({ ...idle, total: 100, done: 110 }), 100);
});
test("activity and errors describe actionable steps rather than raw backend stages", () => {
  assert.match(steamActivity({ ...idle, operation: "download" }), /下载/);
  assert.match(steamActivity({ ...idle, operation: "sync" }), /云/);
  assert.match(steamIssue("Steam 验证失败：InvalidPassword").hint, /昵称/);
  assert.match(steamIssue("TimeoutException").hint, /网络/);
  assert.match(steamIssue("RateLimitExceeded").hint, /稍等/);
  assert.match(steamIssue("其他账号还有待同步存档").hint, /绑定/);
});
