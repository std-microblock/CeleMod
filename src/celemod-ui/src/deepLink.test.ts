import assert from "node:assert/strict";
import test from "node:test";
import { parseCeleModDeepLink } from "./deepLinkParser";

test("parses Mod name and numeric file id", () => {
  assert.deepEqual(parseCeleModDeepLink("celemod://install_mod/FrostHelper"), {
    type: "install_mod",
    value: "FrostHelper",
  });
  assert.deepEqual(parseCeleModDeepLink("celemod://install_mod/12345"), {
    type: "install_mod",
    value: "12345",
  });
});

test("decodes inline profile JSON", () => {
  const profile = {
    format: "celemod-profile",
    version: 2,
    name: "联机",
    enabled_mods: ["CelesteNet.Client"],
  };
  assert.deepEqual(
    parseCeleModDeepLink(
      `celemod://add_profile/${encodeURIComponent(JSON.stringify(profile))}`
    ),
    { type: "add_profile", value: JSON.stringify(profile) }
  );
});

test("accepts literal JSON and rejects malformed links", () => {
  assert.equal(
    parseCeleModDeepLink(
      'celemod://add_profile/{"name":"Test","enabled_mods":[]}'
    ).type,
    "add_profile"
  );
  assert.throws(() => parseCeleModDeepLink("https://install_mod/Test"));
  assert.throws(() => parseCeleModDeepLink("celemod://add_profile/{"));
});
