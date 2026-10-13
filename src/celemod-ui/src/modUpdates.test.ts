import assert from "node:assert/strict";
import test from "node:test";
import {
  collectModUpdates,
  type InstalledModFile,
  type LatestModTuple,
} from "./modUpdates";

const installedMod = (
  overrides: Partial<InstalledModFile> = {},
): InstalledModFile => ({
  name: "SampleMod",
  version: "1.0.0",
  file: "SampleMod.zip",
  isDirectory: false,
  ...overrides,
});

interface LatestModOverrides {
  name?: string;
  version?: string;
  gbFile?: string;
  url?: string;
  xxHash?: string[];
}

const latestMod = (overrides: LatestModOverrides = {}): LatestModTuple => [
  overrides.name ?? "SampleMod",
  overrides.version ?? "1.0.0",
  overrides.gbFile ?? "1234",
  overrides.url ?? "https://example.invalid/SampleMod.zip",
  overrides.xxHash ?? ["aaaaaaaaaaaaaaaa"],
];

test("detects updates from the version number", () => {
  const updates = collectModUpdates([installedMod()], {}, [
    latestMod({ version: "1.1.0" }),
  ]);
  assert.deepEqual(
    updates.map((update) => [update.name, update.current, update.version]),
    [["SampleMod", "1.0.0", "1.1.0"]],
  );
});

test("ignores Mods that are not in the catalog", () => {
  assert.deepEqual(collectModUpdates([installedMod()], {}, []), []);
});

test("detects an update when only the archive changed", () => {
  // aonHelper 0.19.8 still declares 0.19.7, so the version numbers are equal
  // while the installed archive is not the newest file.
  const updates = collectModUpdates(
    [
      installedMod({
        name: "aonHelper",
        version: "0.19.7",
        file: "aonHelper.zip",
      }),
    ],
    { "aonHelper.zip": "749a898300d45f58" },
    [
      latestMod({
        name: "aonHelper",
        version: "0.19.7",
        xxHash: ["1111111111111111"],
      }),
    ],
  );
  assert.equal(updates.length, 1);
  assert.equal(updates[0].version, "0.19.7");
  assert.equal(updates[0].current, "0.19.7");
});

test("keeps Mods whose archive matches the newest file", () => {
  const updates = collectModUpdates(
    [
      installedMod({
        name: "aonHelper",
        version: "0.19.7",
        file: "aonHelper.zip",
      }),
    ],
    { "aonHelper.zip": "749a898300d45f58" },
    [
      latestMod({
        name: "aonHelper",
        version: "0.19.7",
        xxHash: ["749a898300d45f58"],
      }),
    ],
  );
  assert.deepEqual(updates, []);
});

test("cannot compare an unpacked Mod by hash", () => {
  const updates = collectModUpdates(
    [
      installedMod({
        name: "aonHelper",
        version: "0.19.7",
        file: "aonHelper",
        isDirectory: true,
      }),
    ],
    {},
    [
      latestMod({
        name: "aonHelper",
        version: "0.19.7",
        xxHash: ["749a898300d45f58"],
      }),
    ],
  );
  assert.deepEqual(updates, []);
});

test("keeps the version check when the catalog has no hash", () => {
  const updates = collectModUpdates(
    [installedMod({ version: "1.0.0" })],
    { "SampleMod.zip": "ffffffffffffffff" },
    [latestMod({ xxHash: [] })],
  );
  assert.deepEqual(updates, []);
});
