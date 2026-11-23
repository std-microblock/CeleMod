import assert from "node:assert/strict";
import test from "node:test";
import type { ManageNode } from "../stores/manage";
import type { CrashModFix, UpdateInfo } from "./updateInfo";
import {
  extractEverestBuild,
  fetchLatestOfficialEverestStable,
  findRequiredEverestVersion,
  resolveEverestUpdateTarget,
  type OfficialEverestVersion,
} from "./everestUpdate";

const makeNode = (
  name: string,
  options: Partial<ManageNode> = {},
): ManageNode => ({
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

const makeUpdateInfo = (overrides: Partial<UpdateInfo> = {}): UpdateInfo => ({
  version: "1.2.2",
  info: "",
  auto_download: [],
  manual: [],
  ...overrides,
});

test("extractEverestBuild parses plain, semver, azure, prefixed, and empty versions", () => {
  assert.equal(extractEverestBuild("6696"), 6696);
  assert.equal(extractEverestBuild(6696), 6696);
  assert.equal(extractEverestBuild("1.6696.0"), 6696);
  assert.equal(extractEverestBuild("1.5577.0-azure-12345"), 5577);
  assert.equal(extractEverestBuild("v1.6696.0"), 6696);
  assert.equal(extractEverestBuild("V1.5800.1-dev"), 5800);
  assert.equal(extractEverestBuild("5577-ultra"), 5577);
  assert.equal(extractEverestBuild(""), 0);
  assert.equal(extractEverestBuild("   "), 0);
  assert.equal(extractEverestBuild(null), 0);
  assert.equal(extractEverestBuild(undefined), 0);
  assert.equal(extractEverestBuild("0"), 0);
  assert.equal(extractEverestBuild("1.0.0"), 0);
  assert.equal(extractEverestBuild(0), 0);
  assert.equal(extractEverestBuild(-10), 0);
  assert.equal(extractEverestBuild("dev"), 0);
});

test("findRequiredEverestVersion picks highest non-optional build from enabled mods", () => {
  const nodes: Record<string, ManageNode> = {
    DisabledMod: makeNode("DisabledMod", {
      enabled: false,
      dependencies: [
        { name: "Everest", version: "1.9999.0", optional: false },
      ],
    }),
    OptionalOnlyMod: makeNode("OptionalOnlyMod", {
      dependencies: [
        { name: "EverestCore", version: "1.8888.0", optional: true },
      ],
    }),
    OlderMod: makeNode("OlderMod", {
      dependencies: [
        { name: "Everest", version: "1.5000.0", optional: false },
      ],
    }),
    NewerModA: makeNode("NewerModA", {
      dependencies: [
        { name: "Everest", version: "1.6696.0", optional: false },
        { name: "EverestCore", version: "1.6696.0", optional: false },
      ],
    }),
    NewerModB: makeNode("NewerModB", {
      dependencies: [
        { name: "EverestCore", version: "1.6696.0", optional: false },
      ],
    }),
  };

  assert.deepEqual(findRequiredEverestVersion(nodes), {
    build: 6696,
    version: "1.6696.0",
    requiredBy: ["NewerModA", "NewerModB"],
  });
});

test("findRequiredEverestVersion returns null when no enabled mod requires Everest", () => {
  const nodes: Record<string, ManageNode> = {
    RegularMod: makeNode("RegularMod", {
      dependencies: [
        { name: "Celeste", version: "1.4.0.0", optional: false },
        { name: "FrostHelper", version: "1.68.0", optional: false },
      ],
    }),
  };

  assert.equal(findRequiredEverestVersion(nodes), null);
});

test("resolveEverestUpdateTarget handles Official Everest with wegfan and direct mirrors", () => {
  const officialStable: OfficialEverestVersion = {
    version: 6696,
    branch: "stable",
    date: "2026-01-01T00:00:00Z",
    mainDownload: "https://example.com/everest-6696.zip",
  };

  const wegfanResult = resolveEverestUpdateTarget({
    currentEverestVersion: "5577",
    currentEverestIsUltra: false,
    updateInfo: null,
    mirror: "wegfan",
    officialStable,
  });
  assert.equal(wegfanResult.installedBuild, 5577);
  assert.equal(wegfanResult.hasUpdate, true);
  assert.deepEqual(wegfanResult.target, {
    version: "6696",
    build: 6696,
    url: "https://celeste.weg.fan/api/v2/download/everest/6696",
    isUltra: false,
    postInstallFixes: [],
  });

  const directResult = resolveEverestUpdateTarget({
    currentEverestVersion: "1.5577.0-azure-99999",
    currentEverestIsUltra: false,
    updateInfo: null,
    mirror: "0x0ade",
    officialStable,
  });
  assert.equal(directResult.installedBuild, 5577);
  assert.equal(directResult.hasUpdate, true);
  assert.equal(directResult.target?.url, "https://example.com/everest-6696.zip");
});

test("resolveEverestUpdateTarget reports up-to-date and dev-build-0 without false updates", () => {
  const officialStable: OfficialEverestVersion = {
    version: 6696,
    branch: "stable",
    date: "2026-01-01T00:00:00Z",
    mainDownload: "https://example.com/everest-6696.zip",
  };

  const upToDate = resolveEverestUpdateTarget({
    currentEverestVersion: "6696",
    currentEverestIsUltra: false,
    updateInfo: null,
    mirror: "wegfan",
    officialStable,
  });
  assert.equal(upToDate.installedBuild, 6696);
  assert.equal(upToDate.hasUpdate, false);

  const newerInstalled = resolveEverestUpdateTarget({
    currentEverestVersion: "6700",
    currentEverestIsUltra: false,
    updateInfo: null,
    mirror: "wegfan",
    officialStable,
  });
  assert.equal(newerInstalled.installedBuild, 6700);
  assert.equal(newerInstalled.hasUpdate, false);

  const devBuildZero = resolveEverestUpdateTarget({
    currentEverestVersion: "0",
    currentEverestIsUltra: false,
    updateInfo: null,
    mirror: "wegfan",
    officialStable,
  });
  assert.equal(devBuildZero.installedBuild, 0);
  assert.equal(devBuildZero.hasUpdate, false);
});

test("resolveEverestUpdateTarget handles EverestUltra stable selection and RushHelper post-install fix", () => {
  const rushFix: CrashModFix = {
    id: "rush-fix",
    mod_name: "RushHelper",
    affected_versions: ["1.0.0"],
    fixed_version: "1.0.1",
    url: "https://example.com/rushhelper-fixed.zip",
    sha256: "abc123",
  };
  const otherFix: CrashModFix = {
    id: "other-fix",
    mod_name: "OtherHelper",
    affected_versions: ["1.0.0"],
    fixed_version: "1.0.1",
    url: "https://example.com/other.zip",
    sha256: "def456",
  };

  const updateInfo = makeUpdateInfo({
    everest_ultra: {
      enabled: true,
      versions: [
        {
          version: "1.5500.0-ultra",
          channel: "stable",
          date: "2025-11-01",
          url: "https://example.com/ultra-5500.zip",
        },
        {
          version: "1.7000.0-ultra-beta",
          channel: "beta",
          date: "2026-02-01",
          url: "https://example.com/ultra-7000-beta.zip",
        },
        {
          version: "1.6696.0-ultra",
          channel: "",
          date: "2026-01-15",
          url: "https://example.com/ultra-6696.zip",
        },
      ],
    },
    crash_mod_fixes: [rushFix, otherFix],
  });

  const outdated = resolveEverestUpdateTarget({
    currentEverestVersion: "1.5500.0-ultra",
    currentEverestIsUltra: true,
    updateInfo,
    mirror: "wegfan",
    officialStable: null,
  });
  assert.equal(outdated.installedBuild, 5500);
  assert.equal(outdated.hasUpdate, true);
  assert.deepEqual(outdated.target, {
    version: "1.6696.0-ultra",
    build: 6696,
    url: "https://example.com/ultra-6696.zip",
    isUltra: true,
    postInstallFixes: [rushFix],
  });

  const current = resolveEverestUpdateTarget({
    currentEverestVersion: "6696",
    currentEverestIsUltra: true,
    updateInfo,
    mirror: "wegfan",
    officialStable: null,
  });
  assert.equal(current.installedBuild, 6696);
  assert.equal(current.hasUpdate, false);
});

test("fetchLatestOfficialEverestStable picks highest stable build, caches, and resets on error", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  try {
    globalThis.fetch = (async () => {
      callCount += 1;
      return new Response(
        JSON.stringify([
          {
            version: 6800,
            branch: "dev",
            date: "2026-03-01",
            mainDownload: "https://example.com/6800.zip",
          },
          {
            version: 6500,
            branch: "stable",
            date: "2026-01-01",
            mainDownload: "https://example.com/6500.zip",
          },
          {
            version: 6696,
            branch: "stable",
            date: "2026-02-01",
            mainDownload: "https://example.com/6696.zip",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const first = await fetchLatestOfficialEverestStable(true);
    assert.equal(first?.version, 6696);
    assert.equal(callCount, 1);

    const cached = await fetchLatestOfficialEverestStable(false);
    assert.equal(cached?.version, 6696);
    assert.equal(callCount, 1);

    globalThis.fetch = (async () => {
      callCount += 1;
      return new Response("upstream error", { status: 502 });
    }) as typeof globalThis.fetch;

    await assert.rejects(() => fetchLatestOfficialEverestStable(true), /502/);
    assert.equal(callCount, 2);

    // Cache should have been reset after error so a subsequent non-forced call retries.
    globalThis.fetch = (async () => {
      callCount += 1;
      return new Response(
        JSON.stringify([
          {
            version: 6701,
            branch: "stable",
            date: "2026-04-01",
            mainDownload: "https://example.com/6701.zip",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;

    const recovered = await fetchLatestOfficialEverestStable(false);
    assert.equal(recovered?.version, 6701);
    assert.equal(callCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
