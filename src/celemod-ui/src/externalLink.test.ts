import assert from "node:assert/strict";
import test from "node:test";
import { externalLinkUrl } from "./externalLink";

test("keeps absolute HTTP(S) links", () => {
  assert.equal(
    externalLinkUrl("https://example.com/a?b=1#c"),
    "https://example.com/a?b=1#c",
  );
  assert.equal(externalLinkUrl("HTTP://example.com"), "http://example.com/");
  assert.equal(externalLinkUrl("  https://example.com  "), "https://example.com/");
});

test("resolves scheme-relative links to HTTPS", () => {
  // GameBanana stores the Celeste Ranked discord link this way and rendering
  // it as-is made the OS treat it as a file path.
  assert.equal(
    externalLinkUrl("//discord.gg/saQmArFG3f"),
    "https://discord.gg/saQmArFG3f",
  );
  assert.equal(externalLinkUrl("//example.com/x?y=1"), "https://example.com/x?y=1");
});

test("refuses anything that is not an absolute HTTP(S) URL", () => {
  for (const url of [
    "",
    "   ",
    "#heading",
    "/settings",
    "./local.png",
    "../up",
    "discord.gg/saQmArFG3f",
    "mailto:a@example.com",
    "celemod://install",
    "file:///C:/Windows/test.exe",
    "javascript:alert(1)",
    "https://",
    "//",
  ]) {
    assert.equal(externalLinkUrl(url), undefined, url);
  }
});
