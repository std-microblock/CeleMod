import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SPLASH_ROLL_DURATION_MS,
  SPLASH_SPIN_SPEED_DEG_PER_SEC,
  computeNextFrontAngleY,
  computeRollFrame,
  computeSpinState,
} from "./startupSplashMath";

describe("startupSplashMath", () => {
  it("preserves exact continuity at progress = 0", () => {
    const start = computeSpinState(0.73);
    const targetAngleY = computeNextFrontAngleY(start.angleY);
    const frame = computeRollFrame({
      progress: 0,
      start,
      targetAngleY,
      dx: -320,
      dy: -210,
      targetScale: 0.8,
    });

    assert.equal(frame.x, 0);
    assert.equal(frame.y, start.bobY);
    assert.equal(frame.scale, 1);
    assert.equal(frame.angleY, start.angleY);
    assert.equal(frame.tiltX, start.tiltX);
    assert.equal(frame.rollZ, 0);
    assert.equal(frame.depth, 1);
    assert.equal(frame.backdropOpacity, 1);
    assert.equal(frame.chromeOpacity, 1);
    assert.equal(frame.shadowOpacity, start.shadowOpacity);
  });

  it("lands cleanly on target rect, upright and front-facing at progress = 1", () => {
    const start = computeSpinState(1.42);
    const targetAngleY = computeNextFrontAngleY(start.angleY);
    const frame = computeRollFrame({
      progress: 1,
      start,
      targetAngleY,
      dx: -280,
      dy: -195,
      targetScale: 0.8,
    });

    assert.ok(Math.abs(frame.x - -280) < 1e-6);
    assert.ok(Math.abs(frame.y - -195) < 1e-6);
    assert.ok(Math.abs(frame.scale - 0.8) < 1e-6);
    assert.equal(frame.angleY % 360, 0);
    assert.equal(frame.tiltX, 0);
    assert.equal(frame.rollZ, -360);
    assert.equal(frame.depth, 0);
    assert.equal(frame.backdropOpacity, 0);
    assert.equal(frame.chromeOpacity, 0);
    assert.equal(frame.shadowOpacity, 0);
  });

  it("keeps Y-rotation monotonic with C1 angular velocity continuity across all start phases", () => {
    const durationSec = SPLASH_ROLL_DURATION_MS / 1000;
    const eps = 1e-4;

    for (let deg = 0; deg < 720; deg += 37) {
      const start = computeSpinState(deg / SPLASH_SPIN_SPEED_DEG_PER_SEC);
      const targetAngleY = computeNextFrontAngleY(start.angleY);

      const f0 = computeRollFrame({
        progress: 0,
        start,
        targetAngleY,
        dx: -240,
        dy: -180,
        targetScale: 0.8,
        durationSec,
      });
      const fEps = computeRollFrame({
        progress: eps,
        start,
        targetAngleY,
        dx: -240,
        dy: -180,
        targetScale: 0.8,
        durationSec,
      });
      const initialAngularVel = (fEps.angleY - f0.angleY) / (eps * durationSec);
      assert.ok(
        Math.abs(initialAngularVel - SPLASH_SPIN_SPEED_DEG_PER_SEC) < 1.5,
        `expected initial angular velocity ~${SPLASH_SPIN_SPEED_DEG_PER_SEC}, got ${initialAngularVel}`,
      );

      let prevAngle = f0.angleY;
      for (let i = 1; i <= 50; i++) {
        const frame = computeRollFrame({
          progress: i / 50,
          start,
          targetAngleY,
          dx: -240,
          dy: -180,
          targetScale: 0.8,
          durationSec,
        });
        assert.ok(
          frame.angleY >= prevAngle - 1e-9,
          `angleY reversed at step ${i} for start ${deg}`,
        );
        prevAngle = frame.angleY;
      }
      assert.equal(prevAngle, targetAngleY);
    }
  });

  it("keeps trajectory within the bounding box between start and target (never clips above header)", () => {
    const start = computeSpinState(0.5);
    const targetAngleY = computeNextFrontAngleY(start.angleY);
    const dx = -300;
    const dy = -220;
    const minY = Math.min(start.bobY, dy);
    const maxY = Math.max(start.bobY, dy);
    const minX = Math.min(0, dx);
    const maxX = Math.max(0, dx);

    for (let i = 0; i <= 40; i++) {
      const frame = computeRollFrame({
        progress: i / 40,
        start,
        targetAngleY,
        dx,
        dy,
        targetScale: 0.8,
      });
      assert.ok(frame.x >= minX - 1e-6 && frame.x <= maxX + 1e-6);
      assert.ok(frame.y >= minY - 1e-6 && frame.y <= maxY + 1e-6);
    }
  });

  it("rolls clockwise when target is to the right", () => {
    const start = computeSpinState(0.2);
    const targetAngleY = computeNextFrontAngleY(start.angleY);
    const frame = computeRollFrame({
      progress: 1,
      start,
      targetAngleY,
      dx: 120,
      dy: -100,
      targetScale: 0.8,
    });
    assert.equal(frame.rollZ, 360);
  });
});
