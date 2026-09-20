// Match the native Canvas symbols so the launcher previews the actual game button.
export function TouchButtonIcon({
  icon,
  label,
}: {
  icon?: string;
  label: string;
}) {
  const paths: Record<string, string> = {
    CHAT: "M-10-8H10V5H0L-6 10V5H-10Z",
    BOLT: "M2-11L-8 2H-1L-3 11L9-3H2Z",
    STAR: "M0-11L3-4L11-3L5 2L7 10L0 6L-7 10L-5 2L-11-3L-3-4Z",
    BOOK: "M-9-10H9V10H-9ZM-3-10V10M1-4H5",
    KEYBOARD: "M-11-8H11V8H-11ZM-6-3H-5M0-3H1M6-3H7M-5 3H5",
    PAUSE: "M-5-9V9M5-9V9",
    PLAY: "M-6-10L10 0L-6 10Z",
    CONFIRM: "M-9 0L-3 6L10-7",
    BACK: "M-2-8L-10 0L-2 8M-10 0H10",
  };
  return paths[icon ?? ""] ? (
    <svg viewBox="-14 -14 28 28" aria-hidden="true" focusable="false">
      <path
        d={paths[icon!]}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <span>{label || "文字"}</span>
  );
}
