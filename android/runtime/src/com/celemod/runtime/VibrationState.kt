package com.celemod.runtime

/** Pure timing/mixing policy. Game output and optional touch pulses remain independent. */
internal class VibrationState(private val gameEnabled: Boolean) {
    data class Effect(val amplitude: Int, val duration: Long)
    private var active = false
    private var gameAmplitude = 0
    private var gameUntil = 0L
    private var touchAmplitude = 0
    private var touchUntil = 0L

    fun setActive(value: Boolean) {
        active = value
        if (!value) {
            gameAmplitude = 0
            touchAmplitude = 0
            gameUntil = 0
            touchUntil = 0
        }
    }

    fun game(amplitude: Int, now: Long) {
        if (!active || !gameEnabled || amplitude !in 0..255) return
        gameAmplitude = amplitude
        gameUntil = now + 300 // Managed side renews every 100 ms; no endless vibration on a stall.
    }

    fun touch(strength: Int, now: Long) {
        if (!active || strength <= 0) return
        touchAmplitude = (strength.coerceAtMost(100) * 255 / 100).coerceAtLeast(1)
        touchUntil = now + 20
    }

    fun effect(now: Long): Effect {
        val game = if (active && now < gameUntil) gameAmplitude else 0
        val touch = if (active && now < touchUntil) touchAmplitude else 0
        val amplitude = maxOf(game, touch)
        if (amplitude == 0) return Effect(0, 0)
        val until = minOf(if (game > 0) gameUntil else Long.MAX_VALUE,
            if (touch > 0) touchUntil else Long.MAX_VALUE)
        return Effect(amplitude, until - now)
    }
}
