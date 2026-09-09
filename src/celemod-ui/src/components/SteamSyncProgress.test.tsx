import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SteamSyncProgress, steamBytes } from "./SteamSyncProgress";
import { SteamDownloadMeter } from "./steamDownload";
import type { SteamStatus } from "./steamState";

const status: SteamStatus = { account: "test", steamId: "", busy: true, cloud: true, offline: false,
  pending: true, operation: "sync", stage: "syncing", syncPhase: "download", job: "sync-test",
  done: 244, total: 750, completedBytes: 5242880, totalBytes: 8912896, transferredBytes: 475136,
  cachedFiles: 100, currentFile: "a-very-long-mod-save-file.celeste", message: "正在传输 a-very-long-mod-save-file.celeste" };

test("compact entry contains only one bar, short file count and speed", () => {
  const html = renderToStaticMarkup(<SteamSyncProgress status={status} compact rate={{ bytesPerSecond: 7168 }} />);
  assert.match(html, /244 \/ 750 文件/);
  assert.match(html, /7.0 KiB\/s/);
  assert.equal((html.match(/<progress/g) || []).length, 1);
  assert.doesNotMatch(html, /a-very-long|已校验大小|本次传输|复用|剩余/);
});
test("expanded sync details use separate metrics and an ellipsized filename", () => {
  const html = renderToStaticMarkup(<SteamSyncProgress status={status} />);
  assert.match(html, /steam-sync-metrics/);
  assert.match(html, /已校验文件/);
  assert.match(html, /5.0 MiB \/ 8.5 MiB/);
  assert.match(html, /steam-sync-file.*title=/);
});
test("sync speed uses network bytes, not cached saves or file counts", () => {
  const meter = new SteamDownloadMeter();
  meter.sample({ ...status, done: 1, completedBytes: 1024, transferredBytes: 512 }, 0);
  const rate = meter.sample({ ...status, done: 200, completedBytes: 2048, transferredBytes: 1536 }, 2000);
  assert.equal(rate.bytesPerSecond, 512);
  assert.equal(rate.secondsRemaining, (status.totalBytes! - 2048) / 512);
  assert.deepEqual(meter.sample({ ...status, busy: false, stage: "error" }, 3000), {});
});
test("unknown sync totals stay indeterminate and units do not contain line breaks", () => {
  const html = renderToStaticMarkup(<SteamSyncProgress status={{ ...status, total: 0 }} compact />);
  assert.doesNotMatch(html, /value=/);
  assert.equal(steamBytes(1048576), "1.0 MiB");
  assert.equal(steamBytes(-1), "—");
});
