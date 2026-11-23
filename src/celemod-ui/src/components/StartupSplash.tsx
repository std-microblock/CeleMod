import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import _i18n from "../i18n";
import celemodLogo from "../resources/Celemod.png";
import { Collapse, prefersReducedMotion } from "./Motion";
import {
  SPLASH_FADE_FALLBACK_DURATION_MS,
  SPLASH_MIN_SPIN_MS,
  SPLASH_ROLL_DURATION_MS,
  SPLASH_SPIN_SPEED_DEG_PER_SEC,
  type SpinSnapshot,
  clamp01,
  computeNextFrontAngleY,
  computeRollFrame,
  computeSpinState,
  smoothstep,
} from "./startupSplashMath";

type SplashPhase = "hidden" | "spinning" | "rolling" | "fading";

const DEPTH_SLICE_OFFSETS = [3, 2, 1, 0, -1, -2, -3] as const;

const getEffectiveCssZoom = () => {
  if ("__TAURI_INTERNALS__" in window) return 1;
  const raw = Number.parseFloat(document.documentElement.style.zoom || "1");
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
};

const findHomeStrawberryTarget = (): HTMLElement | null => {
  const el = document.querySelector<HTMLElement>(
    '[data-splash-target="strawberry"]',
  );
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return el;
};

const measureTargetDelta = (
  anchorEl: HTMLElement,
  targetEl: HTMLElement,
): { dx: number; dy: number; targetScale: number } | null => {
  const anchorRect = anchorEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();
  if (
    anchorRect.width <= 0 ||
    anchorRect.height <= 0 ||
    targetRect.width <= 0 ||
    targetRect.height <= 0
  ) {
    return null;
  }
  const zoom = getEffectiveCssZoom();
  const anchorCenterX = anchorRect.left + anchorRect.width / 2;
  const anchorCenterY = anchorRect.top + anchorRect.height / 2;
  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;

  return {
    dx: (targetCenterX - anchorCenterX) / zoom,
    dy: (targetCenterY - anchorCenterY) / zoom,
    targetScale: targetRect.width / anchorRect.width,
  };
};

export function StartupSplash({
  visible,
  loadingSlow,
  onSkipCatalog,
  onHandoffTargetHiddenChange,
}: {
  visible: boolean;
  loadingSlow: boolean;
  onSkipCatalog: () => void;
  onHandoffTargetHiddenChange: (hidden: boolean) => void;
}) {
  const [phase, setPhase] = useState<SplashPhase>(() =>
    visible ? "spinning" : "hidden",
  );

  const backdropRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const moverRef = useRef<HTMLDivElement>(null);
  const strawberryRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);

  const shownAtRef = useRef<number>(visible ? performance.now() : 0);
  const spinStartRef = useRef<number>(visible ? performance.now() : 0);
  const latestSpinRef = useRef<SpinSnapshot>(computeSpinState(0));
  const rollTargetElRef = useRef<HTMLElement | null>(null);
  const lastTargetDeltaRef = useRef<{
    dx: number;
    dy: number;
    targetScale: number;
  }>({ dx: 0, dy: 0, targetScale: 0.8 });

  const onHandoffChangeRef = useRef(onHandoffTargetHiddenChange);
  onHandoffChangeRef.current = onHandoffTargetHiddenChange;

  useEffect(() => {
    return () => {
      onHandoffChangeRef.current(false);
    };
  }, []);

  // The spinning splash is the only surface on screen: keep the rest of the
  // frame unpainted so the app (and the desktop behind an acrylic window)
  // cannot bleed through it instead of being blurred there.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle(
      "is-splash-covering",
      phase === "spinning",
    );
    return () => {
      document.documentElement.classList.remove("is-splash-covering");
    };
  }, [phase]);

  // Synchronize external `visible` prop with internal animation phase.
  useEffect(() => {
    if (visible) {
      onHandoffChangeRef.current(false);
      if (phase !== "spinning") {
        const now = performance.now();
        shownAtRef.current = now;
        spinStartRef.current = now;
        latestSpinRef.current = computeSpinState(0);
        setPhase("spinning");
      }
      return;
    }

    if (phase !== "spinning") return;

    if (prefersReducedMotion()) {
      onHandoffChangeRef.current(false);
      setPhase("hidden");
      return;
    }

    const elapsed = performance.now() - shownAtRef.current;
    const remaining = Math.max(0, SPLASH_MIN_SPIN_MS - elapsed);

    const startExit = () => {
      const anchorEl = anchorRef.current;
      const targetEl = findHomeStrawberryTarget();
      const delta =
        anchorEl && targetEl ? measureTargetDelta(anchorEl, targetEl) : null;

      if (targetEl && delta) {
        rollTargetElRef.current = targetEl;
        lastTargetDeltaRef.current = delta;
        onHandoffChangeRef.current(true);
        setPhase("rolling");
      } else {
        rollTargetElRef.current = null;
        onHandoffChangeRef.current(false);
        setPhase("fading");
      }
    };

    if (remaining <= 0) {
      const frame = window.requestAnimationFrame(startExit);
      return () => window.cancelAnimationFrame(frame);
    }

    const timer = window.setTimeout(startExit, remaining);
    return () => window.clearTimeout(timer);
  }, [phase, visible]);

  // Reset inline styles cleanly whenever entering the spinning phase.
  useLayoutEffect(() => {
    if (phase !== "spinning") return;
    if (backdropRef.current) backdropRef.current.style.opacity = "1";
    if (chromeRef.current) {
      chromeRef.current.style.opacity = "1";
      chromeRef.current.style.transform = "translate3d(0, 0, 0)";
    }
    if (moverRef.current) {
      moverRef.current.style.opacity = "1";
      moverRef.current.style.transform = "translate3d(0, 0, 0) scale(1)";
    }
    if (strawberryRef.current) {
      strawberryRef.current.style.setProperty("--splash-depth", "1");
    }
  }, [phase]);

  // Drive 3D spin, seamless roll-to-home, or fade fallback via requestAnimationFrame.
  useEffect(() => {
    if (phase === "hidden") return;

    const reducedMotion = prefersReducedMotion();
    if (reducedMotion) {
      if (strawberryRef.current) {
        strawberryRef.current.style.transform = "none";
        strawberryRef.current.style.setProperty("--splash-depth", "0");
      }
      if (shadowRef.current) {
        shadowRef.current.style.opacity = "0";
      }
      return;
    }

    let rafId = 0;

    if (phase === "spinning") {
      const tickSpin = (now: number) => {
        const elapsedSec = Math.max(0, (now - spinStartRef.current) / 1000);
        const state = computeSpinState(elapsedSec);
        latestSpinRef.current = state;

        if (moverRef.current) {
          moverRef.current.style.transform = `translate3d(0px, ${state.bobY.toFixed(2)}px, 0px) scale(1)`;
        }
        if (strawberryRef.current) {
          strawberryRef.current.style.transform = `rotateX(${state.tiltX.toFixed(2)}deg) rotateY(${state.angleY.toFixed(2)}deg)`;
          strawberryRef.current.style.setProperty("--splash-depth", "1");
        }
        if (shadowRef.current) {
          shadowRef.current.style.transform = `scale(${state.shadowScale.toFixed(3)})`;
          shadowRef.current.style.opacity = state.shadowOpacity.toFixed(3);
        }

        rafId = window.requestAnimationFrame(tickSpin);
      };

      rafId = window.requestAnimationFrame(tickSpin);
      return () => window.cancelAnimationFrame(rafId);
    }

    if (phase === "rolling") {
      const startedAt = performance.now();
      const startSnapshot = { ...latestSpinRef.current };
      const targetAngleY = computeNextFrontAngleY(startSnapshot.angleY);

      const tickRoll = (now: number) => {
        const progress = clamp01((now - startedAt) / SPLASH_ROLL_DURATION_MS);

        const anchorEl = anchorRef.current;
        const targetEl = rollTargetElRef.current;
        let targetVisible = false;
        if (anchorEl && targetEl && targetEl.isConnected) {
          const updated = measureTargetDelta(anchorEl, targetEl);
          if (updated) {
            lastTargetDeltaRef.current = updated;
            targetVisible = true;
          }
        }

        const { dx, dy, targetScale } = lastTargetDeltaRef.current;
        const frame = computeRollFrame({
          progress,
          start: startSnapshot,
          targetAngleY,
          dx,
          dy,
          targetScale,
        });

        if (backdropRef.current) {
          backdropRef.current.style.opacity = frame.backdropOpacity.toFixed(3);
        }
        if (chromeRef.current) {
          chromeRef.current.style.opacity = frame.chromeOpacity.toFixed(3);
          chromeRef.current.style.transform = `translate3d(0px, ${frame.chromeOffsetY.toFixed(2)}px, 0px)`;
        }
        if (moverRef.current) {
          moverRef.current.style.transform = `translate3d(${frame.x.toFixed(2)}px, ${frame.y.toFixed(2)}px, 0px) scale(${frame.scale.toFixed(4)})`;
          moverRef.current.style.opacity = targetVisible
            ? "1"
            : String((1 - smoothstep(0.4, 1, progress)).toFixed(3));
        }
        if (strawberryRef.current) {
          strawberryRef.current.style.transform = `rotateZ(${frame.rollZ.toFixed(2)}deg) rotateX(${frame.tiltX.toFixed(2)}deg) rotateY(${frame.angleY.toFixed(2)}deg)`;
          strawberryRef.current.style.setProperty(
            "--splash-depth",
            frame.depth.toFixed(3),
          );
        }
        if (shadowRef.current) {
          shadowRef.current.style.opacity = frame.shadowOpacity.toFixed(3);
        }

        if (progress < 1) {
          rafId = window.requestAnimationFrame(tickRoll);
          return;
        }

        onHandoffChangeRef.current(false);
        setPhase("hidden");
      };

      rafId = window.requestAnimationFrame(tickRoll);
      return () => window.cancelAnimationFrame(rafId);
    }

    if (phase === "fading") {
      const startedAt = performance.now();
      const startSnapshot = { ...latestSpinRef.current };

      const tickFade = (now: number) => {
        const elapsedMs = now - startedAt;
        const progress = clamp01(elapsedMs / SPLASH_FADE_FALLBACK_DURATION_MS);
        const fade = 1 - smoothstep(0, 1, progress);
        const angleY =
          startSnapshot.angleY +
          (elapsedMs / 1000) * SPLASH_SPIN_SPEED_DEG_PER_SEC;
        const scale = 1 + 0.04 * (1 - fade);

        if (backdropRef.current) {
          backdropRef.current.style.opacity = fade.toFixed(3);
        }
        if (chromeRef.current) {
          chromeRef.current.style.opacity = fade.toFixed(3);
        }
        if (moverRef.current) {
          moverRef.current.style.opacity = fade.toFixed(3);
          moverRef.current.style.transform = `translate3d(0px, ${startSnapshot.bobY.toFixed(2)}px, 0px) scale(${scale.toFixed(4)})`;
        }
        if (strawberryRef.current) {
          strawberryRef.current.style.transform = `rotateX(${startSnapshot.tiltX.toFixed(2)}deg) rotateY(${angleY.toFixed(2)}deg)`;
        }
        if (shadowRef.current) {
          shadowRef.current.style.opacity = (
            startSnapshot.shadowOpacity * fade
          ).toFixed(3);
        }

        if (progress < 1) {
          rafId = window.requestAnimationFrame(tickFade);
          return;
        }

        setPhase("hidden");
      };

      rafId = window.requestAnimationFrame(tickFade);
      return () => window.cancelAnimationFrame(rafId);
    }
  }, [phase]);

  if (phase === "hidden") return null;

  const isExiting = phase === "rolling" || phase === "fading";

  // Rendered into <body> so the fixed mask covers the whole window, titlebar
  // included: inside the app frame it would be clipped to the frame's padding
  // box and painted below the titlebar.
  return createPortal(
    <div
      className={`startup-splash${isExiting ? " is-closing" : ""}`}
      aria-live="polite"
    >
      <div
        className="startup-splash-backdrop"
        ref={backdropRef}
        aria-hidden="true"
      />
      <div className="startup-splash-brand">
        <div className="startup-splash-logo-anchor" ref={anchorRef}>
          <div className="startup-splash-logo-mover" ref={moverRef}>
            <div className="startup-splash-strawberry" ref={strawberryRef}>
              <img
                className="startup-splash-face is-front"
                src={celemodLogo}
                alt="CeleMod"
                draggable={false}
              />
              {DEPTH_SLICE_OFFSETS.map((z) => (
                <img
                  key={z}
                  className="startup-splash-slice"
                  style={{ "--slice-z": `${z}px` } as CSSProperties}
                  src={celemodLogo}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                />
              ))}
              <img
                className="startup-splash-face is-back"
                src={celemodLogo}
                alt=""
                aria-hidden="true"
                draggable={false}
              />
            </div>
          </div>
          <div
            className="startup-splash-shadow"
            ref={shadowRef}
            aria-hidden="true"
          />
        </div>
      </div>

      <div className="startup-splash-chrome" ref={chromeRef}>
        <Collapse
          open={loadingSlow}
          appear
          className="startup-splash-status-collapse"
        >
          <div className="startup-splash-status">
            <div className="startup-splash-status-line">
              <span className="startup-splash-spinner" aria-hidden="true" />
              <span>{_i18n.t("正在加载 Mod 列表，请稍等")}</span>
            </div>
            <button
              type="button"
              className="startup-splash-skip"
              onClick={onSkipCatalog}
            >
              {_i18n.t("跳过下载，离线继续")}
            </button>
          </div>
        </Collapse>
      </div>
    </div>,
    document.body,
  );
}
