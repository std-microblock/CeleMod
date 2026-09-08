package com.celemod.runtime

import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import org.json.JSONObject
import java.io.File

/** Small, atomic snapshots from the managed game thread; disk IO never runs on the UI thread. */
class ControlStateReader(private val file: File, private val onState: (ControlState) -> Unit) {
    private val thread = HandlerThread("CeleMod-controls").apply { start() }
    private val worker = Handler(thread.looper)
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var running = false
    @Volatile private var generation = 0
    private var last = ""
    private val poll = object : Runnable {
        override fun run() {
            if (!running) return
            val session = generation
            try {
                if (file.isFile) {
                    val raw = file.readText()
                    if (raw != last) {
                        val value = JSONObject(raw)
                        if (value.optInt("version") == 1) {
                            val bindings = value.optJSONObject("bindings")
                            val keys = mutableMapOf<String, List<String>>()
                            bindings?.keys()?.forEach { name ->
                                val array = bindings.optJSONArray(name)
                                if (array != null) keys[name] = (0 until array.length()).map { array.getString(it) }
                            }
                            val state = ControlState(ControlMode.parse(value.optString("mode")),
                                value.optBoolean("canTalk"), value.optBoolean("keyboard"), value.optString("ui"), keys)
                            main.post { if (running && session == generation) onState(state) }
                        }
                        last = raw
                    }
                }
            } catch (_: Exception) { /* Keep the last valid layout during an interrupted write. */ }
            if (running && session == generation) worker.postDelayed(this, 50)
        }
    }
    fun start() {
        if (!running) {
            running = true
            val session = ++generation
            worker.post { if (running && session == generation) { last = ""; poll.run() } }
        }
    }
    fun stop() { running = false; generation++; worker.removeCallbacksAndMessages(null); main.removeCallbacksAndMessages(null) }
    fun close() { stop(); thread.quitSafely() }
}
