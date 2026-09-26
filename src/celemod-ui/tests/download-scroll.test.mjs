import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as sass from "sass";

const { css } = sass.compile(
  fileURLToPath(new URL("../src/components/DownloadList.scss", import.meta.url)),
  { logger: sass.Logger.silent },
);

const declarationsFor = (classes) => {
  const declarations = {};
  for (const [, selector, body] of css.matchAll(/^\.([\w-]+)\s*\{([^}]+)\}/gm)) {
    if (!classes.includes(selector)) continue;
    for (const declaration of body.split(";")) {
      const [property, value] = declaration.split(":").map((part) => part.trim());
      if (property && value) declarations[property] = value;
    }
  }
  return declarations;
};

test("the download page owns scrolling", () => {
  const page = declarationsFor(["download-page"]);
  assert.equal(page.height, "100%");
  assert.equal(page.overflow, "auto");
});

test("the task list does not trap wheel scrolling inside the download page", () => {
  const source = readFileSync(
    new URL("../src/components/DownloadList.tsx", import.meta.url),
    "utf8",
  );
  const listClasses = source.match(/className="([^"]*\bdownload-page-list\b[^"]*)"/);
  assert.ok(listClasses, "the download page must render its task list");
  const list = declarationsFor(listClasses[1].split(/\s+/));

  // An auto-sized inner scroll container with contain/none blocks wheel
  // chaining even when it has no overflow of its own. Only the page scrolls.
  for (const property of ["overflow", "overflow-x", "overflow-y"]) {
    assert.equal(list[property] ?? "visible", "visible", property);
  }
  for (const property of ["overscroll-behavior", "overscroll-behavior-y"]) {
    assert.equal(list[property] ?? "auto", "auto", property);
  }
});
