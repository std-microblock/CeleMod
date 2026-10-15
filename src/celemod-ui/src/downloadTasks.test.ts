import assert from "node:assert/strict";
import test from "node:test";
import {
  FINISHED_ROW_GRACE_MS,
  downloadAttemptDecision,
  isDownloadRowVisible,
  nextDownloadRowExpiry,
} from "./downloadTasks";

test("starts a new attempt when no task exists or a forced retry is asked", () => {
  assert.equal(downloadAttemptDecision(undefined, false), "start");
  assert.equal(downloadAttemptDecision({ state: "pending" }, true), "start");
  assert.equal(downloadAttemptDecision({ state: "failed" }, false), "start");
  assert.equal(downloadAttemptDecision({ state: "finished" }, false), "start");
});

test("attaches to an attempt that is still running", () => {
  assert.equal(downloadAttemptDecision({ state: "pending" }, false), "attach");
  assert.equal(
    downloadAttemptDecision({ state: "pending", canceled: false }, false),
    "attach",
  );
});

test("a canceled attempt can be restarted without force", () => {
  // The store keeps `state: "pending"` after a cancel, so this used to be
  // treated as "already downloading" and the request was dropped.
  assert.equal(
    downloadAttemptDecision({ state: "pending", canceled: true }, false),
    "start",
  );
});

test("finished rows disappear after the grace period", () => {
  const now = 1_000_000;
  const finished = { state: "finished" as const, settledAt: now - 1_000 };
  assert.equal(isDownloadRowVisible(finished, now), true);
  assert.equal(
    isDownloadRowVisible(finished, now + FINISHED_ROW_GRACE_MS),
    false,
  );
  // pending / failed / canceled rows stay, they still need controls.
  assert.equal(isDownloadRowVisible({ state: "pending" }, now), true);
  assert.equal(
    isDownloadRowVisible({ state: "pending", canceled: true }, now),
    true,
  );
  assert.equal(
    isDownloadRowVisible({ state: "failed", settledAt: now - 10_000 }, now),
    true,
  );
});

test("reports when the next finished row expires", () => {
  const now = 1_000_000;
  const fresh = { state: "finished" as const, settledAt: now };
  const older = { state: "finished" as const, settledAt: now - 1_000 };
  assert.equal(
    nextDownloadRowExpiry([{ state: "pending" }, older, fresh], now),
    older.settledAt + FINISHED_ROW_GRACE_MS,
  );
  assert.equal(
    nextDownloadRowExpiry([fresh], now),
    now + FINISHED_ROW_GRACE_MS,
  );
  assert.equal(nextDownloadRowExpiry([{ state: "pending" }], now), null);
  assert.equal(
    nextDownloadRowExpiry(
      [{ state: "finished", settledAt: now - FINISHED_ROW_GRACE_MS - 1 }],
      now,
    ),
    null,
  );
});
