export const SPLASH_SPIN_SPEED_DEG_PER_SEC = 210;
export const SPLASH_ROLL_DURATION_MS = 680;
export const SPLASH_FADE_FALLBACK_DURATION_MS = 260;
export const SPLASH_MIN_SPIN_MS = 360;

export interface SpinSnapshot {
  angleY: number;
  bobY: number;
  tiltX: number;
  shadowScale: number;
  shadowOpacity: number;
}

export interface RollFrame {
  x: number;
  y: number;
  scale: number;
  angleY: number;
  tiltX: number;
  rollZ: number;
  depth: number;
  backdropOpacity: number;
  chromeOpacity: number;
  chromeOffsetY: number;
  shadowOpacity: number;
}

export function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function sampleCubicBezier(p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function sampleCubicBezierDerivative(
  p1: number,
  p2: number,
  t: number,
): number {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/**
 * Evaluates cubic-bezier(0.24, 0.9, 0.26, 1) at x in [0, 1].
 * Launches smoothly without a harsh initial snap, glides quickly, and settles softly.
 */
export function easeSplashRoll(x: number): number {
  const clamped = clamp01(x);
  if (clamped === 0 || clamped === 1) return clamped;

  const x1 = 0.24;
  const y1 = 0.9;
  const x2 = 0.26;
  const y2 = 1;

  let lo = 0;
  let hi = 1;
  let t = clamped;
  for (let i = 0; i < 8; i++) {
    const currentX = sampleCubicBezier(x1, x2, t);
    const diff = currentX - clamped;
    if (Math.abs(diff) < 1e-6) break;
    if (diff > 0) hi = t;
    else lo = t;
    const slope = sampleCubicBezierDerivative(x1, x2, t);
    if (slope > 1e-5) {
      const next = t - diff / slope;
      t = next > lo && next < hi ? next : (lo + hi) * 0.5;
    } else {
      t = (lo + hi) * 0.5;
    }
  }
  return sampleCubicBezier(y1, y2, t);
}

export function computeSpinState(elapsedSec: number): SpinSnapshot {
  const angleY = elapsedSec * SPLASH_SPIN_SPEED_DEG_PER_SEC;
  const bobY = Math.sin(elapsedSec * 3.1) * 5;
  const tiltX = Math.sin(elapsedSec * 2.0) * 8;
  const lift = (5 - bobY) / 10;
  return {
    angleY,
    bobY,
    tiltX,
    shadowScale: 1.04 - lift * 0.22,
    shadowOpacity: 0.4 - lift * 0.14,
  };
}

/**
 * Finds the next front-facing multiple of 360deg that leaves at least
 * `minExtraDeg` of forward spin so the strawberry finishes turning naturally.
 */
export function computeNextFrontAngleY(
  startAngleY: number,
  minExtraDeg = 210,
): number {
  return Math.ceil((startAngleY + minExtraDeg) / 360) * 360;
}

/**
 * Cubic Hermite interpolation from 0 to `delta` with starting slope `v0`
 * and ending slope 0. Guarantees C1 angular-velocity continuity at p = 0
 * and zero velocity at p = 1.
 */
export function hermiteScalar(p: number, v0: number, delta: number): number {
  const t = clamp01(p);
  const t2 = t * t;
  const t3 = t2 * t;
  return (t3 - 2 * t2 + t) * v0 + (-2 * t3 + 3 * t2) * delta;
}

export function computeRollFrame({
  progress,
  start,
  targetAngleY,
  dx,
  dy,
  targetScale,
  durationSec = SPLASH_ROLL_DURATION_MS / 1000,
}: {
  progress: number;
  start: SpinSnapshot;
  targetAngleY: number;
  dx: number;
  dy: number;
  targetScale: number;
  durationSec?: number;
}): RollFrame {
  const p = clamp01(progress);
  const moveP = easeSplashRoll(p);
  const u = 1 - moveP;

  // Quadratic Bezier staying strictly inside the bounding box of start -> target,
  // sweeping leftward/horizontally first and curving gently into the header slot.
  const ctrlX = dx * 0.72;
  const ctrlY = start.bobY + (dy - start.bobY) * 0.22;

  const x = 2 * u * moveP * ctrlX + moveP * moveP * dx || 0;
  const y =
    u * u * start.bobY + 2 * u * moveP * ctrlY + moveP * moveP * dy || 0;

  const scale = 1 + (targetScale - 1) * moveP;
  const v0Y = SPLASH_SPIN_SPEED_DEG_PER_SEC * durationSec;
  const angleY =
    start.angleY + hermiteScalar(p, v0Y, targetAngleY - start.angleY);
  const tiltX = start.tiltX * (1 - smoothstep(0, 0.75, p));
  const rollDirection = dx <= 0 ? -1 : 1;
  const rollZ = rollDirection * 360 * moveP || 0;
  const depth = 1 - smoothstep(0.65, 1, p);
  const backdropOpacity = 1 - smoothstep(0, 0.72, p);
  const chromeFade = smoothstep(0, 0.32, p);
  const shadowOpacity = start.shadowOpacity * (1 - smoothstep(0, 0.24, p));

  return {
    x,
    y,
    scale,
    angleY,
    tiltX,
    rollZ,
    depth,
    backdropOpacity,
    chromeOpacity: 1 - chromeFade,
    chromeOffsetY: 8 * chromeFade,
    shadowOpacity,
  };
}
