import assert from "node:assert/strict";
import test from "node:test";
import { collectSwitchNames, type ManageNode } from "./stores/manage";

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
