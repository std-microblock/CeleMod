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
                            val custom = value.optJSONObject("custom")
                            val customButtons = custom?.optJSONArray("buttons")
                            val modButtons = (0 until minOf(customButtons?.length() ?: 0, 24)).mapNotNull { i ->
                                val button = customButtons?.optJSONObject(i) ?: return@mapNotNull null
                                val id = button.optString("id")
                                val code = button.optInt("code")
                                if (!ControlLayout.validId(id) || code !in -24..-1) return@mapNotNull null
                                val icon = ControlIcon.entries.firstOrNull { it.name == button.optString("icon") } ?: ControlIcon.NONE
                                ModButton(id, button.optString("label").take(32), code, button.optBoolean("available"), icon)
                            }.distinctBy { it.id }
                            val state = ControlState(ControlMode.parse(value.optString("mode")),
                                value.optBoolean("canTalk"), value.optBoolean("keyboard"), value.optString("ui"), keys,
                                readTouch(value.optJSONObject("touch")), custom?.optString("epoch") ?: "", modButtons)
                            main.post { if (running && session == generation) onState(state) }
                        }
                        last = raw
                    }
                }
            } catch (_: Exception) { /* Keep the last valid layout during an interrupted write. */ }
            if (running && session == generation) worker.postDelayed(this, 50)
        }
    }
    private fun readTouch(value: JSONObject?): TouchScene? {
        if (value == null) return null
        fun rect(json: JSONObject?): TouchRect? {
            if (json == null) return null
            return TouchRect(json.optDouble("x").toFloat(), json.optDouble("y").toFloat(),
                json.optDouble("w").toFloat(), json.optDouble("h").toFloat()).takeIf { it.valid }
        }
        val viewport = rect(value.optJSONObject("viewport")) ?: return null
        val epoch = value.optString("epoch").takeIf { it.isNotBlank() } ?: return null
        val array = value.optJSONArray("targets") ?: return null
        if (array.length() > 512) return null
        val targets = (0 until array.length()).mapNotNull { i ->
            val target = array.optJSONObject(i) ?: return@mapNotNull null
            val box = rect(target.optJSONObject("rect")) ?: return@mapNotNull null
            val id = target.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            TouchTarget(id, box, target.optString("kind"), target.optString("label"),
                target.optString("text"), target.optInt("maxLength", 128).coerceIn(1, 1024))
        }
        return TouchScene(epoch, value.optString("kind"), viewport, targets).takeIf { targets.isNotEmpty() }
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
