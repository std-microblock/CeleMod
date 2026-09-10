package com.celemod.runtime

import org.junit.Assert.*
import org.junit.Test

class VibrationPlayerTest {
    private class Motor(override val hasAmplitudeControl: Boolean = true) : VibrationPlayer.Motor {
        val pulses = mutableListOf<VibrationState.Effect>()
        var cancellations = 0
        override fun play(duration: Long, amplitude: Int) { pulses += VibrationState.Effect(amplitude, duration) }
        override fun cancel() { cancellations++ }
    }

    @Test fun strengthChangesAmplitudeNotTouchDuration() {
        val motor = Motor()
        val player = VibrationPlayer(motor)
        val state = VibrationState(false).apply { setActive(true) }
        listOf(20, 50, 100).forEachIndexed { index, strength ->
            val now = index * 100L
            state.touch(strength, now)
            assertEquals(20L, player.render(state.effect(now), now))
        }
        assertEquals(listOf(10, 63, 255), motor.pulses.map { it.amplitude })
        assertEquals(listOf(20L, 20L, 20L), motor.pulses.map { it.duration })
    }

    @Test fun gameAndTouchUseTheSameStrengthCurve() {
        val gameMotor = Motor()
        val touchMotor = Motor()
        val gamePlayer = VibrationPlayer(gameMotor)
        val touchPlayer = VibrationPlayer(touchMotor)
        val game = VibrationState(true).apply { setActive(true); game(102, 0) }
        val touch = VibrationState(false).apply { setActive(true); touch(40, 0) }
        gamePlayer.render(game.effect(0), 0)
        touchPlayer.render(touch.effect(0), 0)
        assertEquals(41, gameMotor.pulses.single().amplitude)
        assertEquals(41, touchMotor.pulses.single().amplitude)
        assertEquals(300L, gameMotor.pulses.single().duration)
        assertEquals(20L, touchMotor.pulses.single().duration)
    }

    @Test fun curveIsMonotonicBoundedAndKeepsZeroSilent() {
        assertEquals(0, VibrationPlayer.amplitude(-1))
        assertEquals(0, VibrationPlayer.amplitude(0))
        var previous = 0
        for (input in 1..255) {
            val output = VibrationPlayer.amplitude(input)
            assertTrue(output in 1..255)
            assertTrue(output >= previous)
            if (input < 255) assertTrue(output < 255)
            previous = output
        }
        assertEquals(255, VibrationPlayer.amplitude(255))
        assertEquals(255, VibrationPlayer.amplitude(999))
    }

    @Test fun heartbeatExtendsLeaseWithoutRetriggeringTheMotor() {
        val motor = Motor()
        val player = VibrationPlayer(motor)
        val state = VibrationState(true).apply { setActive(true); game(102, 0) }
        assertEquals(300L, player.render(state.effect(0), 0))
        state.game(102, 100)
        assertEquals(200L, player.render(state.effect(100), 100))
        state.game(102, 200)
        assertEquals(100L, player.render(state.effect(200), 200))
        assertEquals(1, motor.pulses.size)
        assertEquals(200L, player.render(state.effect(300), 300))
        assertEquals(listOf(300L, 200L), motor.pulses.map { it.duration })
        assertEquals(0L, player.render(state.effect(500), 500))
        assertEquals(1, motor.cancellations)
    }

    @Test fun strengthChangeIsImmediateAndOverlayRestoresGame() {
        val motor = Motor()
        val player = VibrationPlayer(motor)
        val state = VibrationState(true).apply { setActive(true); game(255, 0) }
        player.render(state.effect(0), 0)
        state.game(102, 10)
        player.render(state.effect(10), 10)
        state.touch(100, 20)
        assertEquals(20L, player.render(state.effect(20), 20))
        assertEquals(270L, player.render(state.effect(40), 40))
        assertEquals(listOf(255, 41, 255, 41), motor.pulses.map { it.amplitude })
    }

    @Test fun weakerTouchDoesNotRestartOrExtendStrongerGame() {
        val motor = Motor()
        val player = VibrationPlayer(motor)
        val state = VibrationState(true).apply { setActive(true); game(255, 0) }
        player.render(state.effect(0), 0)
        state.touch(20, 10)
        assertEquals(20L, player.render(state.effect(10), 10))
        assertEquals(270L, player.render(state.effect(30), 30))
        assertEquals(1, motor.pulses.size)
        state.game(0, 40)
        assertEquals(0L, player.render(state.effect(40), 40))
        assertEquals(1, motor.cancellations)
    }

    @Test fun gameStopPreservesActiveTouchAndFocusLossClearsEverything() {
        val motor = Motor()
        val player = VibrationPlayer(motor)
        val state = VibrationState(true).apply { setActive(true); game(102, 0); touch(100, 0) }
        player.render(state.effect(0), 0)
        state.game(0, 5)
        assertEquals(15L, player.render(state.effect(5), 5))
        assertEquals(1, motor.pulses.size)
        state.setActive(false)
        assertEquals(0L, player.render(state.effect(6), 6))
        assertEquals(1, motor.cancellations)
        state.setActive(true)
        assertEquals(0L, player.render(state.effect(7), 7))
        assertEquals(1, motor.pulses.size)
    }

    @Test fun repeatedTouchExtendsDeadlineButDoesNotRestartActivePulse() {
        val motor = Motor()
        val player = VibrationPlayer(motor)
        val state = VibrationState(false).apply { setActive(true); touch(50, 0) }
        player.render(state.effect(0), 0)
        state.touch(50, 10)
        assertEquals(10L, player.render(state.effect(10), 10))
        assertEquals(1, motor.pulses.size)
        assertEquals(10L, player.render(state.effect(20), 20))
        assertEquals(0L, player.render(state.effect(30), 30))
    }

    @Test fun unsupportedAmplitudeDoesNotPretendStrengthIsDuration() {
        val motor = Motor(false)
        val player = VibrationPlayer(motor)
        for (input in listOf(1, 128, 255)) {
            player.render(VibrationState.Effect(input, 20), input * 100L)
        }
        assertEquals(List(3) { VibrationState.Effect(-1, 20) }, motor.pulses)
        player.render(VibrationState.Effect(0, 0), 30000)
        assertEquals(1, motor.cancellations)
    }
}
