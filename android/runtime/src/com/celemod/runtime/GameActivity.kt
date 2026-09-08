package com.celemod.runtime

import android.app.AlertDialog
import android.content.Intent
import android.os.*
import android.util.Log
import android.view.WindowManager
import android.view.KeyEvent
import android.view.View
import androidx.activity.OnBackPressedCallback
import android.widget.FrameLayout
import android.widget.Toast
import org.libsdl.app.SDLActivity
import java.io.File

/** SDL + RAL CoreCLR run only in :game; exiting cannot terminate the Tauri manager. */
class GameActivity : SDLActivity() {
    private var controls: TouchControls? = null
    private var exitDialog: AlertDialog? = null
    private var returning = false
    private var gameReady = false
    private var stateReader: ControlStateReader? = null
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val overlay = TouchControls(this, intent.getBooleanExtra("buttons", false), intent.getBooleanExtra("joystick", false),
            onExit = { confirmReturn() }, onKeyboard = { SDLActivity.showTextInput(0, 0, 1, 1) })
        controls = overlay
        overlay.visibility = View.INVISIBLE
        addContentView(overlay, FrameLayout.LayoutParams(-1, -1))
        val progress = File(cacheDir, "game-progress-${Process.myPid()}.json")
        progress.delete()
        val controlFile = File(cacheDir, "game-controls-${Process.myPid()}.json")
        controlFile.delete()
        stateReader = ControlStateReader(controlFile) { state ->
            if (!returning) overlay.setState(state)
        }
        addContentView(GameLoadingOverlay(this, progress) {
            gameReady = true
            overlay.visibility = View.VISIBLE
            overlay.requestApplyInsets()
        }, FrameLayout.LayoutParams(-1, -1))
        // AndroidX bridges both legacy back and Android 13+ predictive-back gestures.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (returning) return
                if (!gameReady) confirmReturn()
                else if (SDLActivity.isScreenKeyboardShown()) {
                    (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager)
                        .hideSoftInputFromWindow(window.decorView.windowToken, 0)
                    mScreenKeyboardShown = false
                    mSurface?.requestFocus()
                }
                else controls?.escape()
            }
        })
    }
    override fun getLibraries() = arrayOf("c++_shared", "SDL2", "main")
    override fun Main(args: Array<String>?) {
        try {
            val root = File(intent.getStringExtra("path")!!)
            val assembly = File(root, "Celeste.dll").takeIf { it.isFile } ?: File(root, "Celeste.exe")
            SDLActivity.nativeAndroidJNISetEnvCurrent()
            val code = RuntimeHost.run(this, assembly, false,
                intent.getBooleanExtra("origin", false), intent.getBooleanExtra("legacyLoader", false))
            if (code != 0) runOnUiThread { Toast.makeText(this, "游戏退出代码 $code，请检查运行日志", Toast.LENGTH_LONG).show() }
        } catch (error: Throwable) {
            Log.e("CeleModRuntime", "Game failed", error)
            runOnUiThread { Toast.makeText(this, error.toString(), Toast.LENGTH_LONG).show() }
        } finally {
            runOnUiThread { returnToManager() }
        }
    }
    override fun onPause() {
        stateReader?.stop()
        controls?.releaseAll()
        super.onPause()
    }
    override fun onResume() {
        super.onResume()
        stateReader?.start()
    }
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        if (!hasFocus) controls?.releaseAll()
        super.onWindowFocusChanged(hasFocus)
    }
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // Physical Back and predictive-back gestures take exactly the same path:
        // one Escape pulse after startup, never terminate the game implicitly.
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP && !event.isCanceled) onBackPressedDispatcher.onBackPressed()
            return true
        }
        return super.dispatchKeyEvent(event)
    }
    @Deprecated("Use AndroidX back dispatcher")
    override fun onBackPressed() {
        onBackPressedDispatcher.onBackPressed()
    }
    private fun confirmReturn() {
        if (exitDialog?.isShowing == true || returning) return
        controls?.releaseAll()
        exitDialog = AlertDialog.Builder(this).setTitle("返回 CeleMod？")
            .setMessage("游戏进程将结束。请先在游戏内保存进度。")
            .setNegativeButton("继续游戏", null)
            .setPositiveButton("返回管理器") { _, _ -> returnToManager() }.show()
    }
    private fun returnToManager() {
        if (returning) return
        returning = true
        controls?.releaseAll()
        packageManager.getLaunchIntentForPackage(packageName)?.let {
            it.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            startActivity(it)
        }
        finish()
    }
    override fun onDestroy() {
        stateReader?.close()
        controls?.releaseAll()
        // SDL's onDestroy waits for SDL_main, which CoreCLR may never return from.
        // Kill only this dedicated game process, never the manager process.
        Process.killProcess(Process.myPid())
        super.onDestroy()
    }
}
