import assert from "node:assert/strict";
import test from "node:test";
import { SteamDownloadMeter, steamEta, steamSpeed } from "./steamDownload";
import { steamProgress, type SteamStatus } from "./steamState";

const base: SteamStatus = {
  account: "test",
  steamId: "1",
  busy: true,
  cloud: true,
  offline: false,
  pending: false,
  operation: "download",
  stage: "downloading",
  job: "one",
  done: 0,
  total: 1000,
  downloadedBytes: 0,
  transferredBytes: 0,
};
const advance = (done: number): SteamStatus => ({
  ...base,
  done,
  downloadedBytes: done,
  transferredBytes: done / 2,
});

test("compressed CDN speed and payload ETA use separate counters", () => {
  const meter = new SteamDownloadMeter();
  assert.deepEqual(meter.sample(base, 0), {});
  assert.deepEqual(meter.sample(advance(100), 1000), {
    bytesPerSecond: 50,
    secondsRemaining: 9,
  });
  assert.deepEqual(meter.sample(advance(300), 2000), {
    bytesPerSecond: 75,
    secondsRemaining: 700 / 150,
  });
});
test("cache reuse advances the bar but never counts as downloaded bytes", () => {
  const meter = new SteamDownloadMeter();
  meter.sample(base, 0);
  assert.deepEqual(meter.sample({ ...base, done: 800 }, 1000), {
    bytesPerSecond: 0,
    secondsRemaining: undefined,
  });
  assert.deepEqual(meter.sample({ ...advance(100), done: 900 }, 2000), {
    bytesPerSecond: 25,
    secondsRemaining: 2,
  });
});
test("unchanged revisions age a stalled transfer to zero without a fake ETA", () => {
  const meter = new SteamDownloadMeter();
  meter.sample(base, 0);
  for (let time = 1000; time <= 10000; time += 1000)
    meter.sample(advance(100), time);
  assert.deepEqual(meter.sample(advance(100), 11000), {
    bytesPerSecond: 0,
    secondsRemaining: undefined,
  });
});
test("job, counter, total and clock resets discard old estimates", () => {
  for (const [next, time] of [
    [{ ...advance(200), job: "two" }, 2000],
    [advance(50), 2000],
    [{ ...advance(200), total: 2000 }, 2000],
    [advance(200), 20000],
    [advance(200), 500],
  ] as const) {
    const meter = new SteamDownloadMeter();
    meter.sample(base, 0);
    meter.sample(advance(100), 1000);
    assert.deepEqual(meter.sample(next, time), {});
  }
});
test("errors, completion, cloud sync, old hosts and malformed samples never retain speed", () => {
  for (const next of [
    undefined,
    { ...base, busy: false },
    { ...base, stage: "syncing" },
    { ...base, downloadedBytes: null },
    { ...base, transferredBytes: undefined },
    { ...base, done: NaN },
    { ...base, total: Infinity },
    { ...base, transferredBytes: -1 },
  ]) {
    const meter = new SteamDownloadMeter();
    meter.sample(base, 0);
    meter.sample(advance(100), 1000);
    assert.deepEqual(meter.sample(next, 2000), {});
    assert.deepEqual(meter.sample(advance(200), 3000), {});
  }
});
test("completion has zero remaining time, even with no new network data", () => {
  const meter = new SteamDownloadMeter();
  meter.sample(base, 0);
  assert.deepEqual(meter.sample({ ...base, done: 1000 }, 1000), {
    bytesPerSecond: 0,
    secondsRemaining: 0,
  });
});
test("speed and ETA formatting covers unavailable, stall, seconds, minutes and hours", () => {
  assert.equal(steamSpeed(), "计算速度…");
  assert.equal(steamSpeed(Infinity), "计算速度…");
  assert.equal(steamSpeed(0), "0 B/s");
  assert.equal(steamSpeed(512), "512 B/s");
  assert.equal(steamSpeed(2048), "2.0 KiB/s");
  assert.equal(steamSpeed(2621440), "2.5 MiB/s");
  assert.equal(steamEta(), "剩余时间待估算");
  assert.equal(steamEta(Infinity), "剩余时间待估算");
  assert.equal(steamEta(0), "下载已完成");
  assert.equal(steamEta(0.1), "剩余约 1 秒");
  assert.equal(steamEta(70), "剩余约 2 分钟");
  assert.equal(steamEta(3660), "剩余约 1 小时 1 分钟");
  assert.equal(steamProgress({ ...base, total: Infinity }), undefined);
  assert.equal(steamProgress({ ...base, done: NaN }), undefined);
});
