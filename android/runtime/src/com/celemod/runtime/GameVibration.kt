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
    // Capability queries can fail too; initialize inside render's guarded path.
    private val player by lazy {
        motor?.takeIf { it.hasVibrator() }?.let { vibrator ->
            VibrationPlayer(object : VibrationPlayer.Motor {
                override val hasAmplitudeControl = vibrator.hasAmplitudeControl()
                override fun play(duration: Long, amplitude: Int) {
                    vibrator.vibrate(VibrationEffect.createOneShot(duration, amplitude), attributes)
                }
                override fun cancel() = vibrator.cancel()
            })
        }
    }
    private var reportedError = false
    private val expire = Runnable { render() }

    fun game(amplitude: Int) { state.game(amplitude, SystemClock.uptimeMillis()); render() }
    fun touch(strength: Int) { state.touch(strength, SystemClock.uptimeMillis()); render() }
    fun setActive(active: Boolean) { state.setActive(active); render() }

    private fun render() {
        handler.removeCallbacks(expire)
        val now = SystemClock.uptimeMillis()
        try {
            val delay = player?.render(state.effect(now), now) ?: return
            if (delay > 0) handler.postDelayed(expire, delay)
        } catch (e: RuntimeException) {
            // Unsupported hardware, permission or service failures must not break gameplay/input.
            if (!reportedError) Log.w("CeleModRuntime", "Phone vibration unavailable", e)
            reportedError = true
        }
    }
}
