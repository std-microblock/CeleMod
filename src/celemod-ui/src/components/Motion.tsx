import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useAnimatedPresence(open: boolean, exitDurationMs = 130) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    if (prefersReducedMotion() || exitDurationMs <= 0) {
      setClosing(false);
      setMounted(false);
      return;
    }
    setClosing(true);
    const timer = window.setTimeout(() => {
      setClosing(false);
      setMounted(false);
    }, exitDurationMs);
    return () => window.clearTimeout(timer);
  }, [exitDurationMs, mounted, open]);

  return { mounted, closing };
}

export function Collapse({
  open,
  appear = false,
  unmountOnExit = true,
  durationMs = 220,
  className = "",
  innerClassName = "",
  style,
  children,
}: {
  open: boolean;
  appear?: boolean;
  unmountOnExit?: boolean;
  durationMs?: number;
  className?: string;
  innerClassName?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open || !unmountOnExit);
  const [expanded, setExpanded] = useState(open && !appear);
  const lastChildrenRef = useRef<ReactNode>(open ? children : null);

  if (open) {
    lastChildrenRef.current = children;
  }

  useEffect(() => {
    if (open) {
      setMounted(true);
      if (prefersReducedMotion()) {
        setExpanded(true);
        return;
      }
      let frame1 = 0;
      let frame2 = 0;
      frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          setExpanded(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }

    setExpanded(false);
    if (!unmountOnExit) return;
    if (prefersReducedMotion() || durationMs <= 0) {
      setMounted(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setMounted(false);
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, open, unmountOnExit]);

  if (!mounted && unmountOnExit) {
    return null;
  }

  const content = open ? children : lastChildrenRef.current;

  return (
    <div
      className={`ui-collapse${expanded ? " is-open" : ""}${className ? ` ${className}` : ""}`}
      aria-hidden={!open || undefined}
      style={style}
    >
      <div
        className={`ui-collapse-inner${innerClassName ? ` ${innerClassName}` : ""}`}
      >
        {content}
      </div>
    </div>
  );
}
