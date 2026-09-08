package com.celemod.runtime

import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.SystemClock
import android.system.Os
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Bounded journal prevents an overwritten file from losing a fast tap. IO is off the UI thread. */
class DirectTouchWriter(cacheDir: File) {
    private val file = File(cacheDir, "game-controls-${Process.myPid()}.json.touch")
    private val thread = HandlerThread("CeleMod-touch-writer").apply { start() }
    private val worker = Handler(thread.looper)
    private val journal = ArrayDeque<JSONObject>()
    private var sequence = SystemClock.elapsedRealtime() * 1000
    @Volatile private var closed = false
    fun send(intent: TouchIntent) {
        if (closed) return
        val sent = System.currentTimeMillis()
        worker.post {
            if (closed) return@post
            journal.addLast(JSONObject().put("seq", ++sequence).put("sentAt", sent)
                .put("epoch", intent.epoch).put("id", intent.id).put("action", intent.action)
                .put("x", intent.x).put("y", intent.y).put("value", intent.value).put("text", intent.text))
            while (journal.size > 32) journal.removeFirst()
            try {
                val temp = File(file.path + ".tmp")
                temp.writeText(JSONArray(journal.toList()).toString())
                Os.rename(temp.path, file.path)
            } catch (_: Exception) { /* Keyboard fallback remains available. */ }
        }
    }
    fun close() { closed = true; worker.removeCallbacksAndMessages(null); thread.quitSafely() }
}
