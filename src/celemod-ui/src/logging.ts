import { invoke } from "@tauri-apps/api/core";

const consoleLevels = ["debug", "info", "log", "warn", "error"] as const;
type ConsoleLevel = (typeof consoleLevels)[number];

const formatValue = (value: unknown): string => {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value, (_key, item) => {
      if (item instanceof Error)
        return { name: item.name, message: item.message, stack: item.stack };
      if (typeof item === "bigint") return item.toString();
      return item;
    });
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
};

const writeLog = (level: ConsoleLevel, values: unknown[]) => {
  if (!("__TAURI_INTERNALS__" in window)) return;
  void invoke("write_frontend_log", {
    level,
    message: values.map(formatValue).join(" "),
  }).catch(() => undefined);
};

export const initializeFrontendLogging = () => {
  for (const level of consoleLevels) {
    const original = console[level].bind(console);
    console[level] = (...values: unknown[]) => {
      original(...values);
      writeLog(level, values);
    };
  }

  window.addEventListener("error", (event) => {
    writeLog("error", [
      "Uncaught frontend error:",
      event.error ?? event.message,
      event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : "",
    ]);
  });
  window.addEventListener("unhandledrejection", (event) => {
    writeLog("error", ["Unhandled frontend rejection:", event.reason]);
  });
};
