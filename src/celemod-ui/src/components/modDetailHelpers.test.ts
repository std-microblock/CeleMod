import assert from "node:assert/strict";
import test from "node:test";
import type { Content } from "../api/wegfan";
import {
  formatCompactNumber,
  formatDetailDate,
  formatDetailSize,
  matchCloudSubmission,
  normalizeCredits,
  resolveExternalLinks,
} from "./modDetailHelpers";

const makeContent = (overrides: Partial<Content>): Content =>
  ({
    id: "sub-1",
    createTime: new Date("2024-01-01T00:00:00Z"),
    updateTime: new Date("2024-05-01T00:00:00Z"),
    deleteTime: null,
    name: "Strawberry Jam",
    submissionType: "GAME_BANANA_MOD",
    submitter: "SJ Team",
    pageUrl: "https://gamebanana.com/mods/424541",
    gameBananaSection: "Mod",
    gameBananaId: 424541,
    categoryId: 6800,
    categoryName: "Maps",
    subCategoryId: null,
    subCategoryName: null,
    subtitle: "",
    description: "",
    views: 0,
    likes: 0,
    downloads: 0,
    screenshots: [],
    credits: [],
    latestUpdateAddedTime: new Date("2024-05-01T00:00:00Z"),
    files: [],
    ...overrides,
  }) as Content;

test("matchCloudSubmission matches by submissionId even for WEGFan-exclusive items", () => {
  const exclusive = makeContent({
    id: "wegfan-only-99",
    name: "Exclusive Map",
    gameBananaId: -1,
  });
  const other = makeContent({
    id: "other-1",
    name: "Exclusive Map",
    gameBananaId: 12345,
  });

  const matched = matchCloudSubmission([other, exclusive], {
    submissionId: "wegfan-only-99",
    gameBananaId: null,
    submissionName: "Exclusive Map",
  });
  assert.equal(matched?.id, "wegfan-only-99");
});

test("matchCloudSubmission falls back to gameBananaId then exact name", () => {
  const item = makeContent({
    id: "sub-42",
    name: "Frost Helper",
    gameBananaId: 53687,
  });
  assert.equal(
    matchCloudSubmission([item], {
      submissionId: "old-id",
      gameBananaId: 53687,
    })?.id,
    "sub-42",
  );
  assert.equal(
    matchCloudSubmission([item], { submissionName: "  frost helper " })?.id,
    "sub-42",
  );
});

test("normalizeCredits preserves grouped roles and deduplicates entries", () => {
  const groups = normalizeCredits([
    {
      groupName: "Key Authors",
      authors: [
        { name: "Alice", role: "Mapper", url: "https://example.com/a" },
        { name: "Alice", role: "Mapper", url: "" },
        { name: "Bob", role: "Music", url: "" },
      ],
    },
    {
      groupName: "Empty",
      authors: [{ name: "   ", role: "", url: "" }],
    },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].groupName, "Key Authors");
  assert.deepEqual(
    groups[0].authors.map((a) => `${a.name}:${a.role}`),
    ["Alice:Mapper", "Bob:Music"],
  );
});

test("normalizeCredits falls back to flat author names", () => {
  const groups = normalizeCredits([], ["Alice", "bob", "alice"], "Credits");
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].authors.map((a) => a.name),
    ["Alice", "bob"],
  );
});

test("resolveExternalLinks orders preferred source first", () => {
  const links = {
    submissionId: "abc",
    gameBananaUrl: "https://gamebanana.com/mods/1",
  };
  assert.deepEqual(
    resolveExternalLinks(links, "wegfan").map((l) => l.source),
    ["wegfan", "gamebanana"],
  );
  assert.deepEqual(
    resolveExternalLinks(links, "gamebanana").map((l) => l.source),
    ["gamebanana", "wegfan"],
  );
});

test("format helpers handle edge cases cleanly", () => {
  assert.equal(formatCompactNumber(999), "999");
  assert.equal(formatCompactNumber(1500), "1.5k");
  assert.equal(formatCompactNumber(2000), "2k");
  assert.equal(formatCompactNumber(1_250_000), "1.3m");
  assert.equal(formatDetailSize(0), "--");
  assert.equal(formatDetailSize(1536), "1.50 KB");
  assert.equal(formatDetailDate(0), null);
  assert.equal(formatDetailDate("invalid"), null);
  assert.equal(formatDetailDate("2025-03-09T12:30:00Z"), "2025-03-09");
});
