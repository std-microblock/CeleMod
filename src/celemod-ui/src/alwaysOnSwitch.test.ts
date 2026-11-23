import assert from "node:assert/strict";
import test from "node:test";
import {
  isAlwaysOnPackage,
  splitAlwaysOnNames,
  switchBlacklistFiles,
  type ManageNode,
} from "./stores/manage";

const node = (name: string, options: Partial<ManageNode> = {}): ManageNode => ({
  name,
  id: "0",
  enabled: true,
  enabledByName: true,
  version: "1.0.0",
  file: `${name}.zip`,
  size: 0,
  modifiedAt: 0,
  isDirectory: false,
  dependencies: [],
  dependedBy: [],
  duplicateFiles: [],
  meta: null,
  ...options,
});

const nodesOf = (...entries: ManageNode[]) =>
  Object.fromEntries(entries.map((entry) => [entry.name, entry]));

test("an always-on Mod is reported instead of being switched silently", () => {
  const nodes = nodesOf(node("AlwaysOn"), node("Free"));
  const { switchable, blocked } = splitAlwaysOnNames({
    names: ["AlwaysOn", "Free"],
    nodes,
    alwaysOnMods: ["AlwaysOn"],
  });
  assert.deepEqual(blocked, ["AlwaysOn"]);
  assert.deepEqual(switchable, ["Free"]);
});

test("always-on is matched by file, so a renamed Mod stays blocked", () => {
  // The stored name no longer exists (the Mod was deleted and reinstalled
  // under another name) but the file is the same one.
  const nodes = nodesOf(node("Renamed", { file: "Renamed.zip" }));
  const { blocked } = splitAlwaysOnNames({
    names: ["Renamed"],
    nodes,
    alwaysOnMods: ["OldName"],
  });
  // A name that is not installed cannot mark the file.
  assert.deepEqual(blocked, []);

  const shared = nodesOf(
    node("Kept", { file: "Kept.zip" }),
    node("Stale", { file: "Kept.zip" }),
  );
  assert.equal(isAlwaysOnPackage("Kept", shared, ["Stale"]), true);
});

test("an unknown always-on name does not block anything", () => {
  const nodes = nodesOf(node("Plain"));
  assert.equal(isAlwaysOnPackage("Plain", nodes, ["DeletedLongAgo"]), false);
  assert.equal(isAlwaysOnPackage("Missing", nodes, ["DeletedLongAgo"]), false);
});

test("disabling a Mod blacklists every file of that name", () => {
  const nodes = nodesOf(
    node("Duplicate", {
      file: "Duplicate.zip",
      duplicateFiles: [
        {
          file: "Duplicate.zip",
          version: "1.0.0",
          size: 0,
          modifiedAt: 0,
          isDirectory: false,
          enabled: true,
        },
        {
          file: "Duplicate Folder",
          version: "0.9.0",
          size: 0,
          modifiedAt: 0,
          isDirectory: true,
          enabled: true,
        },
      ],
    }),
  );
  assert.deepEqual(
    switchBlacklistFiles({ names: ["Duplicate"], nodes, enabled: false }),
    ["Duplicate.zip", "Duplicate Folder"],
  );
  // Enabling only lifts the file the manage tree shows.
  assert.deepEqual(
    switchBlacklistFiles({ names: ["Duplicate"], nodes, enabled: true }),
    ["Duplicate.zip"],
  );
});

test("a Mod without duplicates switches its single file", () => {
  const nodes = nodesOf(node("Plain"));
  assert.deepEqual(
    switchBlacklistFiles({ names: ["Plain"], nodes, enabled: false }),
    ["Plain.zip"],
  );
  assert.deepEqual(
    switchBlacklistFiles({ names: ["Plain"], nodes, enabled: true }),
    ["Plain.zip"],
  );
});
