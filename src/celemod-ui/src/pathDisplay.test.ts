import assert from "node:assert/strict";
import test from "node:test";
import { formatDisplayPath } from "./pathDisplay";

test("replaces the Windows local app data prefix", () => {
  assert.equal(
    formatDisplayPath(
      "C:\\Users\\someone\\AppData\\Local\\CeleMod\\mod_list.json",
    ),
    "%LOCALAPPDATA%\\CeleMod\\mod_list.json",
  );
});

test("replaces the Windows roaming app data prefix", () => {
  assert.equal(
    formatDisplayPath(
      "D:\\Users\\someone\\AppData\\Roaming\\CeleMod\\mod_list.json",
    ),
    "%APPDATA%\\CeleMod\\mod_list.json",
  );
});

test("falls back to a home placeholder for other Windows profiles", () => {
  assert.equal(
    formatDisplayPath("C:\\Users\\someone\\CeleMod\\mod_list.json"),
    "~\\CeleMod\\mod_list.json",
  );
});

test("shortens POSIX home directories", () => {
  assert.equal(
    formatDisplayPath("/home/someone/.cache/CeleMod/mod_list.json"),
    "~/.cache/CeleMod/mod_list.json",
  );
  assert.equal(
    formatDisplayPath("/Users/someone/Library/Caches/CeleMod/mod_list.json"),
    "~/Library/Caches/CeleMod/mod_list.json",
  );
});

test("keeps unknown layouts untouched", () => {
  assert.equal(
    formatDisplayPath("/var/cache/CeleMod/mod_list.json"),
    "/var/cache/CeleMod/mod_list.json",
  );
  assert.equal(formatDisplayPath("mod_list.json"), "mod_list.json");
  assert.equal(formatDisplayPath(""), "");
});
