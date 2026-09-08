// Run against the local fixture via the in-app browser's tab handle, not a phone.
// Uses real pointer clicks and the real theme provider (tokens AND runtime hooks).
import assert from "node:assert/strict";

export async function checkSteamThemes(tab) {
  const results = [];
  const click = name => tab.playwright.getByRole("button", { name, exact: true }).click();
  const read = () => tab.playwright.evaluate(() => {
    const sheet = document.querySelector("dialog[open]");
    const style = e => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return {
      border: s.borderTopWidth, radius: s.borderRadius, background: s.backgroundColor, color: s.color,
      image: s.backgroundImage, width: r.width, height: r.height,
    }; };
    return {
      theme: document.documentElement.dataset.theme,
      hooks: document.documentElement.dataset.materialYouHooks,
      screen: sheet?.querySelector("[data-steam-screen]")?.getAttribute("data-steam-screen"),
      overflow: sheet ? sheet.scrollWidth > sheet.clientWidth + 1 : document.documentElement.scrollWidth > innerWidth,
      controls: [...(sheet?.querySelectorAll(".steam-icon-button,.steam-password button,.steam-settings-link,.steam-text-button") ?? [])].map(style),
      switches: [...(sheet?.querySelectorAll("[role=switch]") ?? [])].map(e => ({ ...style(e), checked: e.checked, thumb: getComputedStyle(e, "::before").transform })),
      primary: sheet?.querySelector(".steam-primary") ? style(sheet.querySelector(".steam-primary")) : null,
      fields: [...(sheet?.querySelectorAll("input:not([type=checkbox])") ?? [])].map(e => ({ ...style(e), autocomplete: e.autocomplete })),
      ripple: document.documentElement.dataset.steamRipple,
      animation: document.documentElement.dataset.steamAnimation,
      enters: Number(document.documentElement.dataset.steamEnterCount ?? 0),
      exits: Number(document.documentElement.dataset.steamExitCount ?? 0),
      entry: style(document.querySelector(".steam-entry")),
      entryBar: !!document.querySelector(".steam-entry progress"),
      stats: document.querySelector(".steam-entry .steam-download-stats")?.textContent,
    };
  });
  const checkLayout = data => {
    assert.equal(data.overflow, false, `${data.theme}/${data.screen}: no horizontal clipping`);
    assert.equal(data.entry.radius, "16px", "theme pill rules cannot override entry card");
    assert.ok(data.entry.height >= 88, "entry retains padding and touch size");
    for (const control of data.controls) assert.equal(parseFloat(control.border), 0, "icon/text controls stay borderless");
  };
  for (const theme of ["vanilla", "fluent", "material-you"]) {
    await click(theme); await click("login");
    await tab.playwright.locator(".steam-entry").click();
    await tab.playwright.getByRole("textbox", { name: "账号", exact: true }).fill("fixture_user");
    await tab.playwright.getByRole("textbox", { name: "密码", exact: true }).fill("fixture_password");
    await click("显示密码");
    let data = await read(); checkLayout(data);
    assert.equal(data.theme, theme); assert.equal(data.screen, "login");
    assert.equal(data.fields.length, 2); assert.ok(data.fields.every(f => f.autocomplete === "off" && f.height >= 48));
    assert.notEqual(data.primary.color, data.primary.background);
    if (theme === "material-you") assert.equal(data.hooks, "installed");
    results.push(`${theme}: login fields, eye button, primary contrast, native theme runtime`);
    await click("关闭 Steam 面板");
    await click("installed"); await tab.playwright.locator(".steam-entry").click();
    await click("账号与云存档设置");
    data = await read(); checkLayout(data);
    assert.equal(data.screen, "settings"); assert.equal(data.switches.length, 2);
    for (const sw of data.switches) {
      assert.equal(sw.width, 44); assert.equal(sw.height, 26); assert.equal(sw.radius, "20px"); assert.equal(sw.image, "none");
    }
    assert.equal(JSON.stringify(data.switches.map(s => s.checked)), "[true,false]");
    await tab.playwright.getByRole("switch", { name: "离线游玩 暂不连接云端，联网后再同步", exact: true }).click();
    data = await read(); assert.equal(data.switches[1].checked, true);
    await tab.playwright.getByRole("switch", { name: "自动云存档 启动前读取云端，退出后上传进度", exact: true }).click();
    await click("关闭自动同步");
    data = await read(); assert.equal(data.switches[0].checked, false); checkLayout(data);
    results.push(`${theme}: cloud/offline switches on/off, confirmation and borderless actions`);
    await click("关闭 Steam 面板");
    await click("conflict"); await tab.playwright.locator(".steam-entry").click();
    checkLayout(await read());
    await click("保留手机进度 将手机上的冲突版本上传到 Steam");
    await click("返回选择");
    await click("使用 Steam 云端进度 将云端的冲突版本下载到手机");
    await click("返回选择");
    data = await read(); checkLayout(data);
    if (theme === "material-you") assert.deepEqual(JSON.parse(data.ripple), { position: "absolute", display: "block", flexGrow: "0" });
    results.push(`${theme}: conflict choice layout and real pointer ripple`);
    await click("关闭 Steam 面板");
    await click("overview"); await tab.playwright.locator(".steam-entry").click();
    await click("下载游戏"); checkLayout(await read());
    await click("开始下载");
    data = await read(); assert.equal(data.screen, "progress"); checkLayout(data);
    await click("收起面板");
    data = await read(); assert.equal(data.entryBar, true);
    // Re-open/close without cancelling the mock job; rate samples must survive.
    await tab.playwright.locator(".steam-entry").click();
    await click("收起面板");
    data = await read(); assert.equal(data.entryBar, true); assert.match(data.stats, /剩余/);
    results.push(`${theme}: download, external progress/metrics, animated close/reopen`);
    await click("preparing");
    assert.equal((await read()).entryBar, true);
    await click("login");
    assert.equal((await read()).entryBar, false);
    data = await read(); assert.ok(data.enters > 0 && data.exits > 0, "both sheet animations ran");
  }
  return results;
}
