import assert from "node:assert/strict";
import test from "node:test";
import {
  collectOrphanDependencyNames,
  collectSwitchNames,
  normalizeManageDependencies,
  type ManageNode,
} from "./stores/manage";

const node = (name: string, options: Partial<ManageNode> = {}): ManageNode => ({
  name,
  id: "0",
  enabled: true,
  version: "1.0.0",
  file: `${name}.zip`,
  size: 0,
  dependencies: [],
  dependedBy: [],
  duplicateFiles: [],
  meta: null,
  ...options,
});

test("deduplicates dependency declarations by Mod name", () => {
  assert.deepEqual(
    normalizeManageDependencies([
      { name: "CollabLobbyUI", version: "1.0.0", optional: true },
      { name: "CollabLobbyUI", version: "1.0.9", optional: false },
      { name: "CollabLobbyUI", version: "1.0.5", optional: true },
    ]),
    [{ name: "CollabLobbyUI", version: "1.0.9", optional: false }],
  );
});

test("disables an unclassified orphan dependency", () => {
  const nodes = {
    Root: node("Root", {
      dependencies: [
        { name: "UnclassifiedDependency", version: "1.0.0", optional: false },
      ],
    }),
    UnclassifiedDependency: node("UnclassifiedDependency", {
      dependedBy: ["Root"],
    }),
  };

  assert.deepEqual(
    collectSwitchNames({
      names: ["Root"],
      enabled: false,
      nodes,
      includeDependencies: true,
      includeOptional: false,
      autoDisableTypes: [],
    }),
    ["Root", "UnclassifiedDependency"],
  );
});

test("keeps a categorized dependency excluded by the orphan type setting", () => {
  const nodes = {
    Root: node("Root", {
      dependencies: [
        { name: "SkinDependency", version: "1.0.0", optional: false },
      ],
    }),
    SkinDependency: node("SkinDependency", {
      dependedBy: ["Root"],
      meta: {
        category: "Skins",
        subCategory: null,
        submitter: "",
        submissionName: "",
        pageUrl: null,
        downloads: 0,
        catalogSize: 0,
        updatedAt: "",
        gameBananaId: null,
      },
    }),
  };

  assert.deepEqual(
    collectSwitchNames({
      names: ["Root"],
      enabled: false,
      nodes,
      includeDependencies: true,
      includeOptional: false,
      autoDisableTypes: [],
    }),
    ["Root"],
  );
});


test("does not treat optional dependencies as orphan deletion candidates", () => {
  const nodes = {
    Root: node("Root", {
      dependencies: [
        { name: "OptionalMod", version: "1.0.0", optional: true },
        { name: "RequiredMod", version: "1.0.0", optional: false },
      ],
    }),
    OptionalMod: node("OptionalMod"),
    RequiredMod: node("RequiredMod", { dependedBy: ["Root"] }),
  };

  assert.deepEqual(
    collectOrphanDependencyNames({ name: "Root", nodes }),
    ["RequiredMod"],
  );
});

test("collects transitive required orphan dependencies", () => {
  const nodes = {
    Root: node("Root", {
      dependencies: [
        { name: "RequiredMod", version: "1.0.0", optional: false },
      ],
    }),
    RequiredMod: node("RequiredMod", {
      dependencies: [
        { name: "NestedMod", version: "1.0.0", optional: false },
      ],
      dependedBy: ["Root"],
    }),
    NestedMod: node("NestedMod", { dependedBy: ["RequiredMod"] }),
  };

  assert.deepEqual(
    collectOrphanDependencyNames({ name: "Root", nodes }),
    ["RequiredMod", "NestedMod"],
  );
});
