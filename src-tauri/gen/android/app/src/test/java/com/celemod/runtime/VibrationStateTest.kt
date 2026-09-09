package com.celemod.runtime

import org.junit.Assert.assertEquals
import org.junit.Test

class VibrationStateTest {
    @Test fun disabledGameRumbleDoesNotDisableTouchFeedback() {
        val state = VibrationState(false)
        state.setActive(true)
        state.game(255, 0)
        assertEquals(VibrationState.Effect(0, 0), state.effect(0))
        state.touch(40, 1)
        assertEquals(VibrationState.Effect(102, 20), state.effect(1))
        assertEquals(VibrationState.Effect(0, 0), state.effect(21))
    }

    @Test fun gameLeaseRenewsAndExpiresWithoutMoreUpdates() {
        val state = VibrationState(true)
        state.setActive(true)
        state.game(102, 10)
        assertEquals(VibrationState.Effect(102, 300), state.effect(10))
        state.game(102, 110)
        assertEquals(VibrationState.Effect(102, 300), state.effect(110))
        assertEquals(VibrationState.Effect(102, 1), state.effect(409))
        assertEquals(VibrationState.Effect(0, 0), state.effect(410))
    }

    @Test fun outputStrengthChangesAndStopsImmediately() {
        val state = VibrationState(true)
        state.setActive(true)
        state.game(255, 0)
        state.game(64, 10)
        assertEquals(VibrationState.Effect(64, 300), state.effect(10))
        state.game(0, 11)
        assertEquals(VibrationState.Effect(0, 0), state.effect(11))
    }

    @Test fun touchPulseTemporarilyOverlaysGameAndThenRestoresIt() {
        val state = VibrationState(true)
        state.setActive(true)
        state.game(102, 0)
        state.touch(100, 10)
        assertEquals(VibrationState.Effect(255, 20), state.effect(10))
        assertEquals(VibrationState.Effect(102, 270), state.effect(30))
        state.touch(100, 40)
        state.game(0, 41)
        assertEquals(VibrationState.Effect(255, 19), state.effect(41))
        assertEquals(VibrationState.Effect(0, 0), state.effect(60))
    }

    @Test fun backgroundFocusLossAndExitClearAllEffectsWithoutReplay() {
        val state = VibrationState(true)
        state.game(255, 0)
        state.touch(100, 0)
        assertEquals(VibrationState.Effect(0, 0), state.effect(0))
        state.setActive(true)
        state.game(255, 1)
        state.touch(100, 1)
        state.setActive(false)
        assertEquals(VibrationState.Effect(0, 0), state.effect(2))
        state.game(255, 3)
        state.touch(100, 3)
        state.setActive(true)
        assertEquals(VibrationState.Effect(0, 0), state.effect(4))
        state.game(128, 5)
        assertEquals(VibrationState.Effect(128, 300), state.effect(5))
    }

    @Test fun invalidAmplitudesAreIgnoredAndWeakOutputRemainsValid() {
        val state = VibrationState(true)
        state.setActive(true)
        state.game(-1, 0)
        state.game(256, 0)
        state.touch(0, 0)
        assertEquals(VibrationState.Effect(0, 0), state.effect(0))
        state.game(1, 1)
        assertEquals(VibrationState.Effect(1, 300), state.effect(1))
        state.game(999, 2)
        assertEquals(VibrationState.Effect(1, 299), state.effect(2))
    }
}
