import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SteamLaunchProgress } from "./SteamLaunchProgress";
import type { SteamStatus } from "./steamState";

const status: SteamStatus = { account: "test", steamId: "", busy: false, cloud: true,
  offline: false, pending: false, operation: "sync", stage: "complete", done: 750, total: 750 };

test("launch feedback renders before the first status response without a fake percentage", () => {
  const html = renderToStaticMarkup(<SteamLaunchProgress />);
  assert.match(html, /role="status"/);
  assert.match(html, /steam-spinner/);
  assert.match(html, /正在准备游戏运行时/);
  assert.match(html, /收起面板继续使用管理器/);
  assert.doesNotMatch(html, /\d+%/);
});

test("queued and launch-time sync explain that the game will wait for verification", () => {
  for (const launchStage of ["waiting-sync", "syncing"] as const) {
    const html = renderToStaticMarkup(<SteamLaunchProgress status={{ ...status, busy: true, launchStage }} />);
    assert.match(html, /正在等待 Steam 云存档同步/);
    assert.match(html, /校验通过后自动进入游戏/);
    assert.doesNotMatch(html, /100%/);
  }
});

test("runtime preparation and activity handoff do not claim cloud sync is still running", () => {
  const preparing = renderToStaticMarkup(<SteamLaunchProgress status={{ ...status, launchStage: "preparing", offline: true }} />);
  assert.match(preparing, /正在准备游戏运行时/);
  assert.doesNotMatch(preparing, /正在等待 Steam/);
  const starting = renderToStaticMarkup(<SteamLaunchProgress status={{ ...status, launchStage: "starting" }} />);
  assert.match(starting, /正在进入游戏/);
});
