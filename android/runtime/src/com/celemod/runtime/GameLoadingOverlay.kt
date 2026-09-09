package com.celemod.runtime

import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import org.json.JSONObject
import java.io.File

/** Displays real Everest splash events, not a timer-based imitation percentage. */
class GameLoadingOverlay(context: Context, private val progressFile: File, private val onReady: () -> Unit) : LinearLayout(context) {
    private val handler = Handler(Looper.getMainLooper())
    private val status = TextView(context)
    private val detail = TextView(context)
    private val bar = ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal)
    private var last = ""
    private val poll = object : Runnable {
        override fun run() {
            try {
                if (progressFile.isFile) {
                    val raw = progressFile.readText()
                    if (raw != last) {
                        last = raw
                        val value = JSONObject(raw)
                        when (value.optString("stage")) {
                            "ready", "unsupported" -> { visibility = GONE; onReady(); return }
                            "mods" -> {
                                val total = value.optInt("total").coerceAtLeast(0)
                                val loaded = value.optInt("loaded").coerceIn(0, total)
                                status.text = "正在加载 Mod · $loaded / $total"
                                detail.text = value.optString("detail")
                                bar.isIndeterminate = total == 0
                                bar.max = total.coerceAtLeast(1)
                                bar.progress = loaded
                            }
                            "resources" -> {
                                status.text = "Mod 已加载，正在初始化游戏资源…"
                                detail.text = "即将进入游戏"
                                bar.isIndeterminate = true
                            }
                            else -> { status.text = "正在启动 Everest…" }
                        }
                    }
                }
            } catch (_: Exception) { /* An interrupted write must not hide or crash the game. */ }
            handler.postDelayed(this, 150)
        }
    }

    init {
        orientation = VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(Color.rgb(19, 19, 19))
        isClickable = true
        val padding = (24 * resources.displayMetrics.density).toInt()
        setPadding(padding, padding, padding, padding)
        addView(TextView(context).apply { text = "CeleMod"; textSize = 28f; setTextColor(Color.WHITE); gravity = Gravity.CENTER })
        status.text = "正在初始化游戏运行时…"
        status.textSize = 17f
        status.setTextColor(Color.WHITE)
        status.gravity = Gravity.CENTER
        addView(status, LayoutParams(-1, -2).apply { topMargin = padding })
        addView(bar, LayoutParams((360 * resources.displayMetrics.density).toInt(), padding).apply { topMargin = padding / 2 })
        bar.isIndeterminate = true
        detail.textSize = 13f
        detail.setTextColor(Color.LTGRAY)
        detail.gravity = Gravity.CENTER
        detail.maxLines = 2
        addView(detail, LayoutParams(-1, -2))
        addView(TextView(context).apply {
            text = "系统返回键或返回手势可取消启动并返回管理器"
            textSize = 12f; setTextColor(Color.GRAY); gravity = Gravity.CENTER
        }, LayoutParams(-1, -2).apply { topMargin = padding })
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); handler.post(poll) }
    override fun onDetachedFromWindow() { handler.removeCallbacks(poll); super.onDetachedFromWindow() }
}
