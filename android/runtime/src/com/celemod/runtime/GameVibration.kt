package com.celemod.runtime

import android.content.Context
import android.media.AudioAttributes
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log

/** Main-thread receiver for SDL's existing JNI command channel; no polling or disk IO. */
internal class GameVibration(context: Context, enabled: Boolean) {
    companion object { const val COMMAND = 0xCE01 }
    @Suppress("DEPRECATION")
    private val motor = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    private val state = VibrationState(enabled)
    private val handler = Handler(Looper.getMainLooper())
    private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).build()
    private var playing = false
    private var reportedError = false
    private val expire = Runnable { render() }

    fun game(amplitude: Int) { state.game(amplitude, SystemClock.uptimeMillis()); render() }
    fun touch(strength: Int) { state.touch(strength, SystemClock.uptimeMillis()); render() }
    fun setActive(active: Boolean) { state.setActive(active); render() }

    private fun render() {
        handler.removeCallbacks(expire)
        val effect = state.effect(SystemClock.uptimeMillis())
        try {
            val vibrator = motor ?: return
            if (effect.amplitude == 0) {
                if (playing) vibrator.cancel()
                playing = false
            } else if (vibrator.hasVibrator()) {
                val amplitude = if (vibrator.hasAmplitudeControl()) effect.amplitude else VibrationEffect.DEFAULT_AMPLITUDE
                vibrator.vibrate(VibrationEffect.createOneShot(effect.duration, amplitude), attributes)
                playing = true
                handler.postDelayed(expire, effect.duration)
            }
        } catch (e: RuntimeException) {
            // Unsupported hardware, permission or service failures must not break gameplay/input.
            if (!reportedError) Log.w("CeleModRuntime", "Phone vibration unavailable", e)
            reportedError = true
        }
    }
}
