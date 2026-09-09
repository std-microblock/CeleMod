package com.celemod.runtime

import android.app.Service
import android.content.Intent
import android.os.*
import android.util.Log
import java.io.File

class InstallerService : Service() {
    private var started = false
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() {
        super.onDestroy()
        // stopService must stop CoreCLR too, otherwise a timed-out install keeps
        // modifying files and the next attempt starts a second worker in it.
        Process.killProcess(Process.myPid())
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) { stopSelf(); return START_NOT_STICKY }
        if (started) return START_NOT_STICKY
        started = true
        @Suppress("DEPRECATION")
        val receiver = intent.getParcelableExtra<ResultReceiver>("receiver")
        Thread({
            var code = -1
            val result = Bundle()
            try {
                code = RuntimeHost.run(this, File(intent.getStringExtra("path")!!), true)
                if (code == 0) {
                    val game = File(intent.getStringExtra("path")!!).parentFile!!
                    check(File(game, "Celeste.dll").isFile) { "Installer returned success without Celeste.dll" }
                    RuntimeHost.configureGameStorage(game)
                    File(getExternalFilesDir(null), "logs/installer.log").appendText("\n[CeleMod] Installer completed successfully.\n")
                }
                if (code != 0) result.putString("error", "MiniInstaller exited $code; see adb logcat / installer log")
            } catch (e: Throwable) {
                code = -1
                Log.e("CeleModRuntime", "MiniInstaller failed", e)
                runCatching { File(getExternalFilesDir(null), "logs/installer.log").appendText("\n$e\n") }
                result.putString("error", e.toString())
            }
            receiver?.send(code, result)
            // CoreCLR and environment are process-global. Never reuse an installer process.
            Handler(Looper.getMainLooper()).postDelayed({ stopSelf(); Process.killProcess(Process.myPid()) }, 500)
        }, "CeleModInstaller").start()
        return START_NOT_STICKY
    }
}
