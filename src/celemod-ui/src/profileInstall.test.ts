import assert from "node:assert/strict";
import test from "node:test";
import { executeProfileImport, type ProfileImportPlan } from "./profileInstall";

const emptyProgress = () => undefined;

const plan = (
  overrides: Partial<ProfileImportPlan> = {},
): ProfileImportPlan => ({
  profiles: [],
  requestedMods: [],
  missingMods: [],
  unresolvedMods: [],
  downloads: [],
  ...overrides,
});

test("does not commit a profile when resolution failed", async () => {
  await assert.rejects(
    executeProfileImport(
      "unused",
      plan({ unresolvedMods: ["Missing.Mod"] }),
      emptyProgress,
    ),
    /Missing\.Mod/,
  );
});

test("empty confirmed profile reaches commit without downloading", async () => {
  await assert.rejects(
    executeProfileImport("unused", plan(), emptyProgress),
    /game path not set/,
  );
});
