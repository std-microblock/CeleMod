import assert from "node:assert/strict";
import test from "node:test";
import { pickDownloadFiles } from "./downloadFiles";
import type { File as SubmissionFile } from "./api/wegfan";

const file = (
  overrides: Partial<SubmissionFile> = {},
): SubmissionFile =>
  ({
    id: "1",
    createTime: new Date(0),
    updateTime: new Date(0),
    deleteTime: null,
    url: "https://celeste.weg.fan/api/v2/download/files/1",
    description: "v1.0.0",
    downloads: 0,
    size: 1024,
    gameBananaId: 100,
    mods: [],
    ...overrides,
  }) as SubmissionFile;

const mod = (id: string, name: string, version = "1.0.0") => ({
  id,
  name,
  version,
  createTime: new Date(0),
  updateTime: new Date(0),
  deleteTime: null,
  xxHash: [],
});

test("keeps the newest file of every Mod and marks the matching one primary", () => {
  const entries = pickDownloadFiles({
    name: "CelesteNet",
    gameBananaId: 53695,
    files: [
      file({ gameBananaId: 3, mods: [mod("m1", "CelesteNet", "1.2.0")] }),
      file({ gameBananaId: 2, mods: [mod("m1", "CelesteNet", "1.1.0")] }),
      file({ gameBananaId: 1, mods: [mod("m2", "CelesteNet.GH")] }),
    ],
  });

  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["3", "1"],
  );
  assert.equal(entries[0].isPrimary, true);
  assert.equal(entries[1].isPrimary, false);
  assert.equal(entries[0].name, "CelesteNet");
});

test("still offers the files when the mirror reports no Mods for them", () => {
  const entries = pickDownloadFiles({
    name: "Darkmoon Ruins",
    gameBananaId: 393245,
    files: [
      file({ gameBananaId: 1059878, description: "", mods: [] }),
      file({ gameBananaId: 1000000, description: "v0.9", mods: [] }),
      file({ gameBananaId: 999999, description: "v0.8", mods: undefined }),
    ],
  });

  // Nothing links the files to a Mod, so no file may be dropped and the first
  // one (the newest the mirror lists) is the primary download.
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["1059878", "1000000", "999999"],
  );
  assert.equal(entries[0].isPrimary, true);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ["Darkmoon Ruins", "v0.9", "v0.8"],
  );
  assert.deepEqual(entries[0].mods, []);
});

test("hands the mirror URL to the downloader for WEGFan-only submissions", () => {
  const entries = pickDownloadFiles({
    name: "Chinese Translation",
    gameBananaId: null,
    files: [
      file({
        url: "https://celeste.weg.fan/api/v2/download/files/188553683618142080",
        gameBananaId: null as unknown as number,
        mods: [mod("m1", "CelesteV1410SimplifiedChineseTranslation")],
      }),
    ],
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "-1");
  assert.equal(
    entries[0].url,
    "https://celeste.weg.fan/api/v2/download/files/188553683618142080",
  );
  assert.equal(entries[0].name, "CelesteV1410SimplifiedChineseTranslation");
  assert.equal(entries[0].isPrimary, true);
});

test("offers nothing when the submission has no file at all", () => {
  assert.deepEqual(
    pickDownloadFiles({ name: "Empty", gameBananaId: 1234, files: [] }),
    [],
  );
  assert.deepEqual(
    pickDownloadFiles({ name: "Empty", gameBananaId: null, files: [] }),
    [],
  );
});
