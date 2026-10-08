import assert from "node:assert/strict";
import test from "node:test";
import { waitForCatalogDownload } from "./catalogDownload";

const never = () => Promise.resolve(false);
const always = () => Promise.resolve(true);
const noop = () => Promise.resolve();

test("returns immediately when no catalog download is running", async () => {
  let waits = 0;
  const settled = await waitForCatalogDownload(never, () => {
    waits += 1;
    return Promise.resolve();
  });
  assert.equal(settled, true);
  assert.equal(waits, 0);
});

test("waits for a slow download to settle", async () => {
  let polls = 0;
  let waits = 0;
  const downloading = () => {
    polls += 1;
    return Promise.resolve(polls < 3);
  };
  const settled = await waitForCatalogDownload(downloading, () => {
    waits += 1;
    return Promise.resolve();
  });
  assert.equal(settled, true);
  assert.equal(polls, 3);
  assert.equal(waits, 2);
});

test("gives up after the polling budget instead of hanging", async () => {
  let waits = 0;
  const settled = await waitForCatalogDownload(always, () => {
    waits += 1;
    return Promise.resolve();
  }, 4, 25);
  assert.equal(settled, false);
  assert.equal(waits, 4);
});
