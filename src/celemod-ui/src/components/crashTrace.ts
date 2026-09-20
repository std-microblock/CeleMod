// Excerpt shaping for the crash assistant.
//
// Everest wraps a crash in `crit-error-handler` breadcrumbs; only the
// "ENCOUNTERED A CRITICAL ERROR" marker starts the actual exception and stack
// frames that the popup should display.
export interface CrashTraceSource {
  excerpt: string;
  exception: string;
}

const LOG_PREFIX =
  /^\([^)]*\)\s+\[Everest\]\s+\[[^\]]+\]\s+\[[^\]]+\]\s*(?:>>\s*)?/;
const EXCEPTION_LINE = /\b(?:System\.)?[\w.`+]+Exception(?::|\s)/;

export const cleanLogPrefix = (line: string) =>
  line.replace(LOG_PREFIX, "").trim();

// Breadcrumbs such as "Created critical error handler for exception ..." also
// contain "critical error" but come after the trace, so matching any of them
// would show a single breadcrumb line instead of the stacktrace.
export const isCrashMarker = (line: string) => {
  const lower = line.toLocaleLowerCase();
  return (
    lower.includes("encountered a critical error") ||
    lower.includes(">>> critical error:") ||
    (lower.includes("[critical]") &&
      (lower.includes("exception") ||
        lower.includes("error") ||
        lower.includes("failed")))
  );
};

export const displayException = ({ excerpt, exception }: CrashTraceSource) => {
  const fromLog = excerpt
    .split(/\r?\n/)
    .map(cleanLogPrefix)
    .find((line) => EXCEPTION_LINE.test(line) && !/^\s*(?:at|在)\s/.test(line));
  return fromLog || exception;
};

export const formatStacktrace = (
  { excerpt }: CrashTraceSource,
  exception: string,
) => {
  const lines = excerpt.split(/\r?\n/);
  const markerIndex = lines.findLastIndex(isCrashMarker);
  const exceptionIndex = lines.findIndex(
    (line, index) =>
      index >= Math.max(0, markerIndex) && EXCEPTION_LINE.test(line),
  );
  const start =
    exceptionIndex >= 0 ? exceptionIndex : Math.max(0, markerIndex + 1);
  const cleaned = lines
    .slice(start, start + 180)
    .map((line) =>
      line
        .replace(LOG_PREFIX, "")
        .replace(/^\s*--->\s*/, "↳ ")
        .replace(/^\s+(at|在)\s+/, "  $1 ")
        .trimEnd(),
    )
    .filter((line, index) => {
      if (index === 0 && cleanLogPrefix(line) === exception.trim())
        return false;
      return !/ENCOUNTERED A CRITICAL ERROR/i.test(line);
    });
  return cleaned.join("\n").trim() || excerpt;
};
