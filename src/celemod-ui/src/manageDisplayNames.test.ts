import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveManageDisplayNames,
  selectVisibleRootNames,
  type ManageNode,
} from "./stores/manage";

test("uses a custom remark as the primary name", () => {
  assert.deepEqual(
    resolveManageDisplayNames(
      "Internal.Mod",
      "Friendly Name",
      "Submission Name",
      true,
    ),
    { primaryName: "Friendly Name", secondaryName: "Internal.Mod" },
  );
});

test("uses a different GameBanana submission name when automatic remarks are enabled", () => {
  assert.deepEqual(
    resolveManageDisplayNames("Internal.Mod", "", "Submission Name", true),
    { primaryName: "Submission Name", secondaryName: "Internal.Mod" },
  );
});

test("keeps the Mod name primary when automatic remarks are disabled", () => {
  assert.deepEqual(
    resolveManageDisplayNames(
      "Internal.Mod",
      undefined,
      "Submission Name",
      false,
    ),
    { primaryName: "Internal.Mod", secondaryName: null },
  );
});

test("does not repeat an identical GameBanana submission name", () => {
  assert.deepEqual(
    resolveManageDisplayNames("Internal.Mod", undefined, "Internal.Mod", true),
    { primaryName: "Internal.Mod", secondaryName: null },
  );
});

test("sorts the management list by the displayed primary name", () => {
  const node = (name: string): ManageNode => ({
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
  });
  const nodes = {
    Zulu: node("Zulu"),
    Alpha: node("Alpha"),
  };

  assert.deepEqual(
    selectVisibleRootNames({
      nodes,
      filters: {
        query: "",
        enabled: "all",
        health: "all",
        types: [],
        updateOnly: false,
        showHiddenTypes: false,
      },
      rootOnly: false,
      includeOptional: false,
      hiddenTypes: [],
      updateNames: new Set(),
      displayNames: {
        Zulu: { primaryName: "Aardvark", secondaryName: "Zulu" },
        Alpha: { primaryName: "Yankee", secondaryName: "Alpha" },
      },
    }),
    ["Zulu", "Alpha"],
  );
});
