package com.celemod.runtime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper

/** Keep the loopback listener alive while the user signs in in another app. */
class MiaoNetAuthService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val expire = Runnable { stopSelf() }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(
            "miaonet-auth", "群服登录授权", NotificationManager.IMPORTANCE_LOW))
        val returnIntent = packageManager.getLaunchIntentForPackage(packageName)!!
        val pending = PendingIntent.getActivity(this, 21472, returnIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        startForeground(21472, Notification.Builder(this, "miaonet-auth")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("CeleMod · 群服登录")
            .setContentText("等待浏览器授权，点击返回 CeleMod 查看结果。")
            .setContentIntent(pending).setOngoing(true).build())
        // Not a permanent service. Also stop if the callback worker is lost.
        handler.postDelayed(expire, 360_000)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_NOT_STICKY
    override fun onTimeout(startId: Int, fgsType: Int) { stopSelf() }
    override fun onDestroy() {
        handler.removeCallbacks(expire)
        super.onDestroy()
    }
}
