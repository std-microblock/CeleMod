package com.celemod.runtime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder

/** Keeps an active transfer alive when the manager briefly leaves the foreground. No permanent service. */
class SteamTransferService : Service() {
    private var wake: android.os.PowerManager.WakeLock? = null
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("steam-transfer", "Steam 下载与云存档", NotificationManager.IMPORTANCE_LOW))
        startForeground(504230, Notification.Builder(this, "steam-transfer")
            .setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("CeleMod · Steam")
            .setContentText("正在登录、下载或同步云存档；详细进度请返回 CeleMod 查看。")
            .setOngoing(true).build())
        wake = getSystemService(android.os.PowerManager::class.java).newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "CeleMod:SteamTransfer")
            .apply { acquire(95 * 60_000L) }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_NOT_STICKY
    override fun onTimeout(startId: Int, fgsType: Int) {
        SteamBridge.command(this, org.json.JSONObject().put("action", "cancel"))
        stopSelf()
    }
    override fun onDestroy() { wake?.let { if (it.isHeld) it.release() }; super.onDestroy() }
}
