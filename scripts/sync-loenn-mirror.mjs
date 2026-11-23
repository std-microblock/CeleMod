#!/usr/bin/env node
/**
 * Sync the upstream Lönn (or LoennUltra with `--ultra`) release into the CeleMod COS mirror.
 *
 * CeleMod's Loenn page reads `loenn` / `loenn_ultra` from updateInfo.json on COS and installs
 * packages from https://cos-cdn-hk.microblock.cc/celemod/loenn/<version>/<asset>
 * (or .../celemod/loenn-ultra/<version>/<asset> when `--ultra` is passed).
 *
 * Usage:
 *   node scripts/sync-loenn-mirror.mjs --check     # only report whether a new version exists
 *   node scripts/sync-loenn-mirror.mjs --dry-run   # download + verify, no upload / no rewrite
 *   node scripts/sync-loenn-mirror.mjs             # full sync (defaults to latest upstream release)
 *     --ultra                   sync djgrayon/LoennUltra into `loenn_ultra`
 *     --version 1.0.13          pin a specific upstream tag
 *     --description "..."       Chinese one-liner shown in the app (defaults to the release body)
 *     --no-prune                keep every existing version entry (default keeps the newest 4)
 *     --skip-exe-check          skip verifying the packaged executable name
 *
 * Requires: `gh` (authenticated, for release metadata/assets) and `rclone` (remote `tencent-cos:`).
 *
 * The last line of stdout is machine readable:
 *   RESULT: up-to-date current=<v>
 *   RESULT: update-available current=<v> latest=<v>
 *   RESULT: synced version=<v>
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const ULTRA = flag("ultra");
const UPSTREAM_REPO = ULTRA ? "djgrayon/LoennUltra" : "CelestialCartographers/Loenn";
const COS_REMOTE = "tencent-cos:ganbei-hot-update-1258625969";
const UPDATE_INFO_KEY = "celemod/updateInfo.json";
const LOENN_PREFIX = ULTRA ? "celemod/loenn-ultra" : "celemod/loenn";
const ASSET_PREFIX = ULTRA ? "LoennUltra-v" : "Loenn-v";
const UPDATE_INFO_SECTION = ULTRA ? "loenn_ultra" : "loenn";
const CDN_BASE = "https://cos-cdn-hk.microblock.cc";
const APP_UPDATE_INFO_URL =
  "https://ganbei-hot-update-1258625969.file.myqcloud.com/celemod/updateInfo.json";
const MAX_VERSIONS = 4;

/** platform -> asset name pattern + how it is installed by src-tauri/src/backend.rs */
const PLATFORMS = ULTRA
  ? [
      {
        platform: "windows",
        suffix: "-windows.zip",
        packageType: "zip",
        executable: "Lönn.exe",
      },
      {
        platform: "linux",
        suffix: "-linux.zip",
        packageType: "zip",
        executable: "Lönn.sh",
      },
      {
        platform: "macos",
        suffix: "-macos.zip",
        packageType: "zip",
        executable: "Lönn.app/Contents/MacOS/Lönn.sh",
      },
    ]
  : [
      {
        platform: "windows",
        suffix: "-windows.zip",
        packageType: "zip",
        executable: "Lönn.exe",
      },
      {
        platform: "linux",
        suffix: "-linux.AppImage",
        packageType: "file",
        executable: null, // file name == asset name
      },
      {
        platform: "macos",
        suffix: "-macos.app.zip",
        packageType: "zip",
        executable: "Lönn.app/Contents/MacOS/love",
      },
    ];

const CHECK_ONLY = flag("check");
const DRY_RUN = flag("dry-run");
const SKIP_EXE_CHECK = flag("skip-exe-check");
const KEEP_ALL = flag("no-prune");
const PINNED_VERSION = value("version")?.replace(/^v/, "");
const DESCRIPTION = value("description");

const log = (...parts) => console.error(...parts);
const result = (line) => console.log(`RESULT: ${line}`);

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${commandArgs.join(" ")} exited ${result.status}: ${(result.stderr || "").trim()}`,
    );
  }
  return (result.stdout || "").toString();
};

const runBuffer = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, { maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${commandArgs.join(" ")} exited ${result.status}: ${(result.stderr || "").toString().trim()}`,
    );
  }
  return result.stdout;
};

const sha256 = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const fetchUpstreamRelease = () => {
  const json = run("gh", [
    "release",
    "view",
    PINNED_VERSION ? `v${PINNED_VERSION}` : "",
    "-R",
    UPSTREAM_REPO,
    "--json",
    "tagName,name,publishedAt,body,assets,isPrerelease,isDraft",
  ].filter(Boolean));
  const release = JSON.parse(json);
  if (!release.tagName) throw new Error("gh returned no tagName for the upstream release");
  if (release.isDraft) throw new Error(`${release.tagName} is still a draft release`);
  return {
    version: release.tagName.replace(/^v/, ""),
    publishedAt: release.publishedAt,
    body: (release.body || "").trim(),
    assets: release.assets.map((asset) => ({ name: asset.name, size: asset.size })),
  };
};

const readRemoteUpdateInfo = () => {
  const raw = runBuffer("rclone", ["cat", `${COS_REMOTE}/${UPDATE_INFO_KEY}`]).toString("utf8");
  return { raw, json: JSON.parse(raw) };
};

const writeRemoteUpdateInfo = (json) => {
  const next = `${JSON.stringify(json, null, 2)}\n`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loenn-updateinfo-"));
  const tempFile = path.join(tempDir, "updateInfo.json");
  fs.writeFileSync(tempFile, next, "utf8");
  run("rclone", ["copyto", tempFile, `${COS_REMOTE}/${UPDATE_INFO_KEY}`]);
  fs.rmSync(tempDir, { recursive: true, force: true });
  return next;
};

/**
 * List zip entry names from the central directory.
 * `tar -tf` is not usable here: bsdtar transcodes UTF-8 names to the console code page and
 * turns "Lönn.exe" into "L?nn.exe", which would look like a packaging bug.
 */
/** Credentials live in the rclone remote config, so the CDN purge inherits them. */
const tencentCredentials = () => {
  try {
    const output = run("rclone", ["config", "file"]);
    const match = output.match(/stored at:\s*(.+)/i);
    const file = match ? match[1].trim() : null;
    if (!file || !fs.existsSync(file)) return null;
    const section = fs
      .readFileSync(file, "utf8")
      .split(/^\[/m)
      .find((part) => part.trimStart().startsWith("tencent-cos]"));
    if (!section) return null;
    const read = (key) => section.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m"))?.[1]?.trim();
    const secretId = read("access_key_id");
    const secretKey = read("secret_access_key");
    return secretId && secretKey ? { secretId, secretKey } : null;
  } catch {
    return null;
  }
};

/**
 * The app reads updateInfo.json from the COS CDN domain, which caches aggressively, so a fresh
 * upload can stay invisible for hours. Purge it (best effort: needs `tccli`). One URL at a time:
 * a single unknown host fails the whole batch, and only the hostnames that are registered as CDN
 * domains can be purged at all.
 */
const purgeCdnCache = (urls) => {
  const purged = [];
  for (const url of urls) {
    const credentials = tencentCredentials();
    const env = { ...process.env };
    if (credentials) {
      env.TENCENTCLOUD_SECRET_ID = credentials.secretId;
      env.TENCENTCLOUD_SECRET_KEY = credentials.secretKey;
    }
    const command = ["tccli", "cdn", "PurgeUrlsCache", "--cli-unfold-argument", "--Urls", `"${url}"`].join(
      " ",
    );
    const purge = spawnSync(command, { shell: true, encoding: "utf8", env, timeout: 120_000 });
    if (purge.status !== 0) {
      log(`note: CDN purge skipped for ${url} (${(purge.stderr || purge.error?.message || "").trim()})`);
      continue;
    }
    const taskId = (purge.stdout || "").match(/"TaskId":\s*"(\d+)"/)?.[1];
    log(`CDN purge requested for ${url}${taskId ? ` (task ${taskId})` : ""}`);
    purged.push(url);
  }
  return purged;
};

const listZipEntries = (file) => {
  const buffer = fs.readFileSync(file);
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const entries = [];
  let offset = buffer.indexOf(signature);
  while (offset >= 0) {
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.push(name.normalize("NFC"));
    offset = buffer.indexOf(signature, offset + 46 + nameLength + extraLength + commentLength);
  }
  return entries;
};

const downloadAssets = (release, directory) => {
  const patterns = PLATFORMS.map((entry) => `${ASSET_PREFIX}${release.version}${entry.suffix}`);
  for (const name of patterns) {
    if (!release.assets.some((asset) => asset.name === name)) {
      throw new Error(`Upstream ${release.version} is missing expected asset ${name}`);
    }
  }
  run("gh", [
    "release",
    "download",
    `v${release.version}`,
    "-R",
    UPSTREAM_REPO,
    ...patterns.flatMap((pattern) => ["-p", pattern]),
    "-D",
    directory,
    "--clobber",
  ]);
  return PLATFORMS.map((entry) => {
    const file = path.join(directory, `${ASSET_PREFIX}${release.version}${entry.suffix}`);
    if (!fs.existsSync(file)) throw new Error(`Downloaded asset is missing: ${file}`);
    const stats = fs.statSync(file);
    return {
      platform: entry.platform,
      packageType: entry.packageType,
      executable: entry.executable ?? path.basename(file),
      fileName: path.basename(file),
      filePath: file,
      size: stats.size,
      sha256: sha256(file),
    };
  });
};

const verifyExecutable = (asset) => {
  if (asset.packageType !== "zip" || SKIP_EXE_CHECK) return;
  const entries = listZipEntries(asset.filePath);
  const wanted = asset.executable.normalize("NFC").toLowerCase();
  const found = entries.find((entry) => entry.toLowerCase() === wanted);
  if (!found) {
    throw new Error(
      `${asset.fileName} does not contain ${asset.executable} (top-level entries: ${entries
        .slice(0, 8)
        .join(", ")})`,
    );
  }
};

const headOrRange = async (url, expectedSize) => {
  const head = await fetch(url, { method: "HEAD" }).catch((error) => ({ ok: false, error }));
  if (head.ok) {
    const length = head.headers.get("content-length");
    if (expectedSize && length && Number(length) !== expectedSize) {
      throw new Error(`${url} reports ${length} bytes, expected ${expectedSize}`);
    }
    return;
  }
  const ranged = await fetch(url, { headers: { Range: "bytes=0-0" } });
  if (ranged.status !== 200 && ranged.status !== 206) {
    throw new Error(`${url} is not reachable (${ranged.status})`);
  }
};

const verifyPublishedOnce = async (version, assets) => {
  const response = await fetch(APP_UPDATE_INFO_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`updateInfo.json fetch failed (${response.status})`);
  const appInfo = await response.json();
  const latest = appInfo?.[UPDATE_INFO_SECTION]?.versions?.[0];
  if (latest?.version !== version) {
    return `updateInfo.json still reports ${UPDATE_INFO_SECTION} ${latest?.version ?? "<none>"} (cached)`;
  }
  for (const asset of assets) {
    const published = latest.packages?.[asset.platform];
    if (!published) throw new Error(`updateInfo.json has no ${asset.platform} package`);
    if (published.sha256 !== asset.sha256) {
      throw new Error(`updateInfo.json ${asset.platform} sha256 mismatch`);
    }
    await headOrRange(published.url, asset.size);
    await headOrRange(`${CDN_BASE}/${LOENN_PREFIX}/${version}/${asset.fileName}`, asset.size);
  }
  return null;
};

const waitForPublished = async (version, assets, timeoutMs = 240_000) => {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 1; ; attempt += 1) {
    const stale = await verifyPublishedOnce(version, assets);
    if (!stale) return true;
    if (Date.now() > deadline) {
      log(`warning: ${stale}; origin is correct, edge cache will expire on its own`);
      return false;
    }
    log(`waiting for CDN propagation (attempt ${attempt}): ${stale}`);
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
};

const buildVersionEntry = (release, assets, description) => ({
  version: release.version,
  date: release.publishedAt,
  description: description || release.body.split(/\r?\n/).filter(Boolean).join(" ") || undefined,
  packages: Object.fromEntries(
    assets.map((asset) => [
      asset.platform,
      {
        url: `${CDN_BASE}/${LOENN_PREFIX}/${release.version}/${asset.fileName}`,
        file_name: asset.fileName,
        package_type: asset.packageType,
        executable: asset.executable,
        size: asset.size,
        sha256: asset.sha256,
      },
    ]),
  ),
});

const main = async () => {
  const release = fetchUpstreamRelease();
  const { json: updateInfo } = readRemoteUpdateInfo();
  let loenn = updateInfo[UPDATE_INFO_SECTION];
  if (!loenn) {
    if (!ULTRA) {
      throw new Error("updateInfo.json has no loenn.versions");
    }
    loenn = {
      enabled: true,
      // Loenn Ultra 只对简体中文界面展示；非中文用户回落到官方 Lönn。
      only_zh_cn: true,
      default_tab: "ultra",
      name: "Loenn Ultra",
      description:
        "基于 better-loenn 的社区增强分支，优化中文界面与输入法输入、原生支持 macOS Apple Silicon，提供大图多线程加载、素材预览图与 14 款批量制图脚本；使用独立的 loenn2-settings.conf 配置，不会覆盖原版 Lönn 设置。",
      homepage: "https://github.com/djgrayon/LoennUltra",
      versions: [],
    };
  }
  if (!ULTRA && !loenn.versions?.length) {
    throw new Error("updateInfo.json has no loenn.versions");
  }

  const existingVersions = Array.isArray(loenn.versions) ? loenn.versions : [];
  const current = existingVersions[0]?.version ?? null;
  log(`upstream: ${release.version} (${release.publishedAt})`);
  log(`mirror:   ${current ?? "<none>"}`);

  if (current !== null) {
    const comparison = compareVersions(release.version, current);
    if (comparison === 0 && !flag("force")) {
      result(`up-to-date current=${current}`);
      return;
    }
    if (comparison < 0 && !flag("force")) {
      log(`upstream ${release.version} is older than mirror ${current}; nothing to do`);
      result(`up-to-date current=${current}`);
      return;
    }
  }
  if (CHECK_ONLY) {
    result(`update-available current=${current ?? "none"} latest=${release.version}`);
    return;
  }

  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `${ULTRA ? "loenn-ultra" : "loenn"}-${release.version}-`),
  );
  try {
    log(`downloading ${release.version} assets into ${workDir}`);
    const assets = downloadAssets(release, workDir);
    for (const asset of assets) {
      verifyExecutable(asset);
      log(`  ${asset.platform}: ${asset.fileName} ${asset.size}B sha256=${asset.sha256}`);
    }

    if (DRY_RUN) {
      const entry = buildVersionEntry(release, assets, DESCRIPTION);
      log(JSON.stringify(entry, null, 2));
      result(`dry-run latest=${release.version}`);
      return;
    }

    for (const asset of assets) {
      const destination = `${COS_REMOTE}/${LOENN_PREFIX}/${release.version}/${asset.fileName}`;
      log(`uploading ${asset.fileName} -> ${destination}`);
      run("rclone", ["copyto", asset.filePath, destination]);
    }

    const entry = buildVersionEntry(release, assets, DESCRIPTION);
    const kept = [entry, ...existingVersions.filter((item) => item.version !== release.version)];
    updateInfo[UPDATE_INFO_SECTION] = {
      ...loenn,
      versions: KEEP_ALL ? kept : kept.slice(0, MAX_VERSIONS),
    };
    const raw = writeRemoteUpdateInfo(updateInfo);
    log("updateInfo.json rewritten:");
    log(raw.split("\n").slice(0, 4).join("\n"));

    purgeCdnCache([
      APP_UPDATE_INFO_URL,
      `${CDN_BASE}/${UPDATE_INFO_KEY}`,
      ...assets.map((asset) => `${CDN_BASE}/${LOENN_PREFIX}/${release.version}/${asset.fileName}`),
    ]);
    const propagated = await waitForPublished(release.version, assets);
    result(`synced version=${release.version}${propagated ? "" : " cache=pending"}`);
  } finally {
    if (!DRY_RUN) fs.rmSync(workDir, { recursive: true, force: true });
    else log(`dry-run work dir kept at ${workDir}`);
  }
};

/** 1.0.10 vs 1.0.9 -> positive when a is newer; tolerant of short forms like "1.1". */
function compareVersions(a, b) {
  const parse = (input) =>
    String(input)
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
