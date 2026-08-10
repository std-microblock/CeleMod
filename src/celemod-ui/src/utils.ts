import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { callRemote } from "./tauri/commands";

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export { callRemote };

export const useBlockingMask = () => {
  const [maskEnabled, setMaskEnabled] = useState(false);
  const [maskText, setMaskText] = useState("");

  let element = document.querySelector(".blocking-mask") as HTMLElement;
  if (!element) {
    element = document.createElement("div");
    element.className = "blocking-mask";
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    element.innerHTML = [
      '<div class="blocking-mask-panel">',
      '<span class="blocking-mask-spinner" aria-hidden="true"></span>',
      '<span class="blocking-mask-text"></span>',
      '</div>',
    ].join("");
    document.body.appendChild(element);
  }

  useEffect(() => {
    const text = element.querySelector(".blocking-mask-text");
    if (text) text.textContent = maskText;
    const pendingHide = Number(element.dataset.hideTimer || 0);
    if (pendingHide) window.clearTimeout(pendingHide);

    if (maskEnabled) {
      element.style.display = "flex";
      requestAnimationFrame(() => {
        element.style.opacity = "1";
      });
    } else {
      element.style.opacity = "0";
      const hideTimer = window.setTimeout(() => {
        element.style.display = "none";
        delete element.dataset.hideTimer;
      }, 180);
      element.dataset.hideTimer = String(hideTimer);
    }
  }, [element, maskEnabled, maskText]);

  return {
    setMaskEnabled,
    setMaskText,
  };
};

export class EventTarget {
  listeners: { [key: string]: Function[] } = {};
  addEventListener(name: string, cb: Function) {
    if (!this.listeners[name]) this.listeners[name] = [];
    this.listeners[name].push(cb);
  }
  on(name: string, cb: Function) {
    this.addEventListener(name, cb);
  }
  removeEventListener(name: string, cb: Function) {
    if (!this.listeners[name]) return;
    this.listeners[name] = this.listeners[name].filter((v) => v !== cb);
  }
  remove(name: string, cb: Function) {
    this.removeEventListener(name, cb);
  }
  dispatchEvent(name: string, ...args: any[]) {
    if (!this.listeners[name]) return;
    this.listeners[name].forEach((cb) => cb(...args));
  }
}

// polyfill for URLSearchParams
export class URLSearchParams {
  private params: Map<string, string> = new Map();
  constructor(init?: string | { [key: string]: string | string[] }) {
    if (typeof init === "string") {
      init.split("&").forEach((v) => {
        const [k, v_] = v.split("=");
        this.params.set(k, v_);
      });
    } else if (init) {
      Object.entries(init).forEach(([k, v]) => {
        this.params.set(k, v.toString());
      });
    }
  }
  set(key: string, value: string) {
    this.params.set(key, value);
  }
  toString() {
    return [...this.params.entries()]
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
  }
}

export const getCelemodUA = async () => {
  const [version, hash] = await Promise.all([
    callRemote<string>("celemod_version"),
    callRemote<string>("celemod_hash"),
  ]);
  return `CeleMod/${version}-${hash.slice(0, 6)}`;
};

export const displayDate = (date_: string | Date) => {
  const date = new Date(date_);
  const pad = (v: number) => v.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
};

// if a > b, return 1 else -1, 0 if equal
export const compareVersion = (a: string, b: string) => {
  // any part of the version is greater
  const aParts = a.split(".");
  const bParts = b.split(".");
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || "0";
    const bPart = bParts[i] || "0";
    if (aPart === bPart) {
      continue;
    }
    return parseInt(aPart) > parseInt(bPart) ? 1 : -1;
  }
  return 0;
};

export const selectGamePath = async (
  successCallback: (path: string) => void
) => {
  const selected = await open({
    multiple: false,
    directory: true,
  });
  if (typeof selected === "string") {
    const path = await callRemote<string>("normalize_game_path", selected);
    if (!(await callRemote<boolean>("verify_celeste_install", path))) {
      alert("Invalid Celeste install path.");
      return;
    }
    console.log("Selected", path);
    successCallback(path);
    return path;
  }
};

export type Awaitable<T> = T | Promise<T>;

export const horizontalScrollMouseWheelHandler =
  (smooth = true) =>
  (e) => {
    // @ts-ignore
    if (e.deltaY === 0) return;
    e.preventDefault();
    e.stopPropagation();
    // @ts-ignore
    e.currentTarget.scrollTo({
      // @ts-ignore
      left: e.currentTarget.scrollLeft + e.deltaY * 2,
      behavior: smooth ? "smooth" : "instant",
    });
  };
