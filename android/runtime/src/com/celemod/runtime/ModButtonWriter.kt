package com.celemod.runtime

import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.SystemClock
import android.system.Os
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Snapshot journal retains fast taps; heartbeat leases prevent stuck holds after suspension. */
class ModButtonWriter(cacheDir: File) {
    private val file = File(cacheDir, "game-controls-${Process.myPid()}.json.buttons")
    private val thread = HandlerThread("CeleMod-mod-buttons").apply { start() }
    private val worker = Handler(thread.looper)
    private val journal = ArrayDeque<JSONObject>()
    private var sequence = SystemClock.elapsedRealtime() * 1000
    private var epoch = ""
    private var held = emptyList<String>()
    private val heartbeat = object : Runnable {
        override fun run() {
            if (held.isNotEmpty()) { write(); worker.postDelayed(this, 250) }
        }
    }
    private fun write() {
        if (epoch.isBlank()) return
        journal.addLast(JSONObject().put("seq", ++sequence).put("sentAt", System.currentTimeMillis())
            .put("epoch", epoch).put("held", JSONArray(held)))
        while (journal.size > 64) journal.removeFirst()
        try {
            val temp = File(file.path + ".tmp")
            temp.writeText(JSONArray(journal.toList()).toString())
            Os.rename(temp.path, file.path)
        } catch (_: Exception) { /* Game-side lease expires safely if IO fails. */ }
    }
    fun set(nextEpoch: String, nextHeld: List<String>) {
        worker.post {
            if (epoch == nextEpoch && held == nextHeld) return@post
            worker.removeCallbacks(heartbeat)
            epoch = nextEpoch; held = nextHeld.toList(); write()
            if (held.isNotEmpty()) worker.postDelayed(heartbeat, 250)
        }
    }
    fun close() {
        worker.post {
            worker.removeCallbacks(heartbeat); held = emptyList(); write(); thread.quitSafely()
        }
    }
}
