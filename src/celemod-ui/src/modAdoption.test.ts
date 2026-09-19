import assert from "node:assert/strict";
import test from "node:test";
import { selectAdoptableModNames } from "./modAdoption";

const settings = {
  installed: [
    { name: "Enabled", file: "Enabled.zip" },
    { name: "Copied", file: "Copied.zip" },
  ],
  profileEnabledNames: ["Enabled"],
  blacklistEnabledNames: ["Enabled", "Copied"],
  knownNames: ["Enabled"],
  alwaysOnNames: [],
  enableNewMods: true,
};

test("adopts a Mod that was copied into the Mods folder", () => {
  assert.deepEqual(selectAdoptableModNames(settings), ["Copied"]);
});

test("keeps Mods CeleMod already saw out of the adoption", () => {
  assert.deepEqual(
    selectAdoptableModNames({ ...settings, knownNames: ["Enabled", "Copied"] }),
    [],
  );
});

test("leaves new Mods disabled when the default says so", () => {
  assert.deepEqual(
    selectAdoptableModNames({ ...settings, enableNewMods: false }),
    [],
  );
});

test("does not adopt Mods that CeleMod disabled on purpose", () => {
  assert.deepEqual(
    selectAdoptableModNames({
      ...settings,
      blacklistEnabledNames: ["Enabled"],
    }),
    [],
  );
});

test("ignores always-on Mods and duplicate files", () => {
  assert.deepEqual(
    selectAdoptableModNames({
      ...settings,
      installed: [
        { name: "Copied", file: "Copied.zip" },
        { name: "copied", file: "Copied (old).zip" },
        { name: "Always", file: "Always.zip" },
      ],
      blacklistEnabledNames: ["Enabled", "Copied", "Always"],
      alwaysOnNames: ["Always"],
    }),
    ["Copied"],
  );
});
