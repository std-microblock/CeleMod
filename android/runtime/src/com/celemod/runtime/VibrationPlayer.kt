package com.celemod.runtime

import kotlin.math.roundToInt

/** Phone output policy, kept Android-free so the actual motor requests can be tested. */
internal class VibrationPlayer(private val motor: Motor) {
    interface Motor {
        val hasAmplitudeControl: Boolean
        fun play(duration: Long, amplitude: Int)
        fun cancel()
    }

    companion object {
        const val DEFAULT_AMPLITUDE = -1

        // Expand the contrast between weak/medium/full output instead of changing
        // pulse length. Apply once, after mixing, to both game and touch feedback.
        // Keep nonzero input nonzero and reserve full drive for full strength.
        fun amplitude(input: Int): Int {
            val strength = input.coerceIn(0, 255) / 255.0
            return if (strength == 0.0) 0 else (strength * strength * 255).roundToInt().coerceAtLeast(1)
        }
    }

    private var playingAmplitude = 0
    private var playingUntil = 0L

    /** Returns the next wake-up delay, or zero when silent. No repeating effects. */
    fun render(effect: VibrationState.Effect, now: Long): Long {
        if (effect.amplitude <= 0 || effect.duration <= 0) {
            if (playingAmplitude != 0) motor.cancel()
            playingAmplitude = 0
            playingUntil = 0
            return 0
        }

        val output = if (motor.hasAmplitudeControl) amplitude(effect.amplitude) else DEFAULT_AMPLITUDE
        if (playingAmplitude != output || now >= playingUntil) {
            motor.play(effect.duration, output)
            playingAmplitude = output
            playingUntil = now + effect.duration
        }
        // A 100 ms game heartbeat only renews the lease. Let the existing pulse
        // finish rather than restarting the motor (and its onset) every heartbeat.
        // Still wake at a shorter source deadline to restore/stop a mixed effect.
        return minOf(effect.duration, playingUntil - now)
    }
}
