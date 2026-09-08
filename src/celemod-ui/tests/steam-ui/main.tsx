import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createThemeContext } from "../../src/context/theme";
import { SteamAccount } from "../../src/components/SteamAccount";
import type { SteamStatus } from "../../src/components/steamState";
import "../../src/index.scss";
import "virtual:steam-mobile-style";

const idle: SteamStatus = { account: "theme_test", steamId: "76561198000000000", busy: false, cloud: true, offline: false, pending: false, hasSavedPassword: true };
let status: SteamStatus = { ...idle, account: "" };
let running = false;
let tick = 0;
// DOM-visible instrumentation for real pointer/runtime and transition regressions.
document.addEventListener("animationstart", event => {
  if (event.target instanceof HTMLDialogElement) {
    document.documentElement.dataset.steamAnimation = event.animationName;
    if (event.animationName === "steam-sheet-enter" || event.animationName === "steam-sheet-exit") {
      const key = event.animationName === "steam-sheet-enter" ? "steamEnterCount" : "steamExitCount";
      document.documentElement.dataset[key] = String(Number(document.documentElement.dataset[key] ?? 0) + 1);
    }
  }
}, true);
document.addEventListener("pointerdown", () => {
    const ripple = document.querySelector(".steam-sheet .md-ripple, .steam-entry .md-ripple");
    if (!ripple) return;
    const style = getComputedStyle(ripple);
    document.documentElement.dataset.steamRipple = JSON.stringify({ position: style.position, display: style.display, flexGrow: style.flexGrow });
});
mockIPC((command, payload) => {
  if (command !== "android_steam") throw new Error(`Unexpected fixture IPC: ${command}`);
  const request = (payload as any).request;
  if (request.action === "settings") status = { ...status, ...request };
  if (request.action === "cancel") { running = false; status = { ...idle, stage: "cancelled" }; }
  if (request.action === "logout") status = { ...idle, account: "", hasSavedPassword: false };
  if (request.action === "login") status = { ...idle, busy: true, stage: "guard-device", operation: "login" };
  if (request.action === "guard") status = { ...idle };
  if (request.action === "download") startDownload();
  if (request.action === "resolve") status = { ...idle, game: "/fixture/Celeste" };
  return { ...status };
});
function startDownload() {
  running = true; tick = 0;
  status = { ...idle, busy: true, operation: "download", stage: "downloading", job: String(Date.now()),
    done: 512 * 1048576, total: 1280 * 1048576, downloadedBytes: 0, transferredBytes: 0 };
}
setInterval(() => {
  if (!running) return;
  tick++;
  status = { ...status, done: (512 + tick * 2) * 1048576, downloadedBytes: tick * 2 * 1048576, transferredBytes: tick * 1048576 };
}, 1000);

function Fixture() {
  const theme = createThemeContext();
  const [key, setKey] = useState(0);
  const scenario = (name: string) => {
    running = false;
    status = { ...idle };
    if (name === "login") status.account = "";
    if (name === "installed") status.game = "/fixture/Celeste";
    if (name === "conflict") status = { ...status, game: "/fixture/Celeste", stage: "conflict", conflicts: [{ name: "0.celeste", local: "a", remote: "b" }] };
    if (name === "progress") startDownload();
    if (name === "preparing") status = { ...status, busy: true, operation: "download", stage: "manifest" };
    setKey(key + 1);
  };
  return <main style={{ padding: 16, height: "100%", boxSizing: "border-box", overflow: "auto" }}>
    <h1 style={{ fontSize: 18 }}>Steam theme regression</h1>
    <nav aria-label="Theme" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{theme.themes.map(t => <button key={t.id} onClick={() => theme.setTheme(t.id)}>{t.id}</button>)}</nav>
    <nav aria-label="Scenario" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>{["login", "overview", "installed", "conflict", "progress", "preparing"].map(s => <button key={s} onClick={() => scenario(s)}>{s}</button>)}</nav>
    <button onClick={() => { running = false; }}>Stall download</button>
    <section style={{ marginTop: 24 }}><SteamAccount key={key} /></section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
