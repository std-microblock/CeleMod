import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { UpdateNotes, updateNotesUrl } from "./UpdateNotes";

const render = (text: string) =>
  renderToStaticMarkup(<UpdateNotes onOpenLink={() => {}}>{text}</UpdateNotes>);

test("renders Markdown headings, emphasis, lists, quotes and code", () => {
  const html = render(
    [
      "## 更新内容",
      "",
      "**修复**与*改进*，使用 \u0060CeleMod\u0060。",
      "",
      "- 第一项",
      "  - 嵌套项",
      "",
      "1. 有序项",
      "",
      "> 提示",
      "",
      "\u0060\u0060\u0060text",
      "<example>",
      "\u0060\u0060\u0060",
    ].join("\n"),
  );
  for (const expected of [
    "<h2>更新内容</h2>",
    "<strong>修复</strong>",
    "<em>改进</em>",
    "<code>CeleMod</code>",
    "<ul>",
    "<ol>",
    "<blockquote>",
    '<pre><code class="language-text">&lt;example&gt;',
  ]) {
    assert.ok(html.includes(expected), expected);
  }
});

test("renders GFM tables, task lists, strikethrough and autolinks", () => {
  const html = render(
    "| 功能 | 状态 |\n| --- | --- |\n| Markdown | 支持 |\n\n- [x] 完成\n\n~~旧版~~ https://example.com",
  );
  assert.match(html, /<table>/);
  assert.match(html, /<th>功能<\/th>/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /checked=""/);
  assert.match(html, /<del>旧版<\/del>/);
  assert.match(html, /href="https:\/\/example.com\/"/);
});

test("preserves plain-text line breaks and handles empty notes", () => {
  assert.match(
    render("第一行\n第二行\r\n第三行"),
    /第一行<br\/>\n第二行<br\/>\n第三行/,
  );
  assert.equal(render(""), '<div class="update-notes"></div>');
});

test("does not render raw HTML or unsafe links and images", () => {
  const html = render(
    '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[危险](javascript:alert%281%29) [文件](file:///C:/Windows/test.exe) [相对路径](/settings) ![图片](data:image/png;base64,AAAA)',
  );
  assert.doesNotMatch(
    html,
    /<script|<img|onerror|href=|javascript:|file:|data:/,
  );
  assert.match(html, /危险/);
  assert.match(html, /图片/);
});

test("only permits absolute HTTP(S) URLs to reach the system opener", () => {
  assert.equal(
    updateNotesUrl("https://example.com/notes?a=1#fix"),
    "https://example.com/notes?a=1#fix",
  );
  assert.equal(updateNotesUrl("HTTP://example.com"), "http://example.com/");
  for (const url of [
    "",
    "#heading",
    "/notes",
    "//example.com",
    "mailto:a@example.com",
    "celemod://install",
    "javascript:alert(1)",
    "https://",
    " https://example.com",
  ]) {
    assert.equal(updateNotesUrl(url), undefined, url);
  }
});
