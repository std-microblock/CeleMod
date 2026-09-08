package com.celemod.runtime

import android.app.Activity
import android.content.Intent
import android.os.*
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.*
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

@TauriPlugin
class RuntimePlugin(private val activity: Activity) : Plugin(activity) {
    private val worker = Executors.newSingleThreadExecutor()
    private var installing = false
    init { SteamBridge.initialize(activity.applicationContext) }
    override fun load(webView: WebView) {
        super.load(webView)
        val host = activity as? AppCompatActivity ?: return
        // Tauri disables WebView history navigation. Android Back must dismiss the
        // Steam sheet (or its confirmation step), not leave the manager underneath it.
        host.onBackPressedDispatcher.addCallback(host, object : OnBackPressedCallback(true) {
            private var handling = false
            override fun handleOnBackPressed() {
                if (handling) return
                handling = true
                webView.evaluateJavascript("""
                    (() => {
                        const sheet = document.querySelector('dialog.steam-sheet[open]');
                        if (!sheet) return false;
                        if (sheet.dispatchEvent(new Event('cancel', { cancelable: true }))) sheet.close();
                        return true;
                    })()
                """.trimIndent()) { handled ->
                    handling = false
                    if (handled != "true") {
                        isEnabled = false
                        host.onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })
    }
    override fun onResume() { super.onResume(); SteamBridge.recover(activity.applicationContext) }
    private fun gameRunning() = (activity.getSystemService(android.content.Context.ACTIVITY_SERVICE) as android.app.ActivityManager)
        .runningAppProcesses.orEmpty().any { it.uid == android.os.Process.myUid() && it.processName == activity.packageName + ":game" }
    private fun root() = File(activity.getExternalFilesDir(null), "games").apply { mkdirs() }
    private fun settingsFile() = File(activity.filesDir, "android-controls.json")
    private fun settings(): JSONObject = if (settingsFile().isFile) JSONObject(settingsFile().readText()) else JSONObject()
    private fun checkedPath(raw: String): File {
        val path = File(raw).canonicalFile
        require(path.toPath().startsWith(root().canonicalFile.toPath())) { "Game must be in ${root()}" }
        require(path.relativeTo(root().canonicalFile).invariantSeparatorsPath.split('/').none {
            it.startsWith("Steam-") && it.contains(".download-")
        }) { "Steam 下载暂存目录不能启动或安装 Everest，请完成下载后选择正式游戏目录。" }
        return path
    }

    @Command fun info(invoke: Invoke) {
        val result = JSObject()
        result.put("gameRoot", root().absolutePath)
        result.put("buttons", settings().optBoolean("buttons", false))
        result.put("joystick", settings().optBoolean("joystick", false))
        result.put("runtime", "RotatingArtLauncher 2.1.1 / CoreCLR 10.0.4")
        invoke.resolve(result)
    }

    @Command fun configure(invoke: Invoke) {
        try {
            val args = invoke.getArgs()
            val value = JSONObject().put("buttons", args.optBoolean("buttons", false))
                .put("joystick", args.optBoolean("joystick", false))
            val temp = File(activity.filesDir, "android-controls.json.tmp")
            temp.writeText(value.toString())
            check(temp.renameTo(settingsFile())) { "Cannot save control settings" }
            info(invoke)
        } catch (e: Exception) { invoke.reject(e.message) }
    }

    @Command fun pickPackage(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/zip"
        }
        startActivityForResult(invoke, intent, "packageSelected")
    }

    @ActivityCallback fun packageSelected(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) { invoke.resolve(); return }
        worker.execute {
            var output: File? = null
            try {
                val inbox = File(activity.cacheDir, "package-imports").apply { mkdirs() }
                val filename = activity.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                    if (it.moveToFirst()) it.getString(0) else null
                } ?: "package.zip"
                // Preserve the Mod filename (blacklists refer to it), but never provider-controlled paths.
                require(filename.endsWith(".zip", true) && !filename.contains('/') && !filename.contains('\\')) { "Select a ZIP package" }
                val directory = File(inbox, java.util.UUID.randomUUID().toString()).apply { mkdirs() }
                val target = File(directory, filename)
                output = target
                activity.contentResolver.openInputStream(uri)!!.use { input ->
                    target.outputStream().use { out ->
                        val buffer = ByteArray(128 * 1024)
                        var total = 0L
                        while (true) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            total += n
                            require(total <= 2L * 1024 * 1024 * 1024) { "Package exceeds 2 GiB" }
                            out.write(buffer, 0, n)
                        }
                    }
                }
                invoke.resolve(JSObject().apply { put("path", target.absolutePath) })
            } catch (e: Exception) { output?.delete(); invoke.reject(e.message) }
        }
    }

    @Command fun launch(invoke: Invoke) {
        try {
            check(!installing) { "Everest installation is still running" }
            check(!SteamBridge.busy && !SteamBridge.launching) { "请等待 Steam 下载或云存档同步完成" }
            check(!gameRunning()) { "Game is already running. Exit the game before starting another session." }
            val args = invoke.getArgs()
            val path = checkedPath(args.getString("path"))
            require(File(path, "Content").isDirectory) { "Missing game Content directory; deploy your own game first" }
            if (File(path, ".celemod-steam.json").exists()) {
                require(File(path, "Celeste.dll").isFile) { "Steam 资源已下载；请先在 Everest 页面安装 Android 兼容的 Everest。" }
            }
            SteamBridge.launching = true
            worker.execute {
                try {
                    SteamBridge.beforeLaunch(activity.applicationContext, path)
                    RuntimeHost.prepare(activity)
                    val intent = Intent(activity, GameActivity::class.java)
                        .putExtra("path", path.absolutePath)
                        .putExtra("origin", args.optBoolean("origin"))
                        .putExtra("legacyLoader", args.optBoolean("legacyLoader"))
                        .putExtra("buttons", settings().optBoolean("buttons"))
                        .putExtra("joystick", settings().optBoolean("joystick"))
                    activity.runOnUiThread {
                        try {
                            activity.startActivity(intent)
                            SteamBridge.watchGame(activity.applicationContext)
                            invoke.resolve(JSObject().put("started", true) as JSObject)
                        } catch (e: Exception) { SteamBridge.launching = false; invoke.reject(e.message) }
                    }
                } catch (e: Exception) { SteamBridge.launching = false; invoke.reject(e.message) }
            }
        } catch (e: Exception) { invoke.reject(e.message) }
    }

    @Command fun canInstall(invoke: Invoke) {
        if (gameRunning() || installing || SteamBridge.busy || SteamBridge.launching) invoke.reject("Exit the game / wait for the current installer or Steam operation before installing Everest")
        else invoke.resolve()
    }

    @Command fun openUrl(invoke: Invoke) {
        try {
            val uri = android.net.Uri.parse(invoke.getArgs().getString("url"))
            require(uri.scheme in listOf("http", "https")) { "Android can open only web links here; manage local files inside CeleMod" }
            activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
            invoke.resolve()
        } catch (e: Exception) { invoke.reject(e.message) }
    }

    @Command fun installEverest(invoke: Invoke) {
        try {
            check(!installing) { "An installer is already running" }
            check(!gameRunning() && !SteamBridge.busy && !SteamBridge.launching) { "请先退出游戏，等待 Steam 操作完成" }
            val path = checkedPath(invoke.getArgs().getString("path"))
            require(path.name == "MiniInstaller.dll" && path.isFile) { "Missing MiniInstaller.dll" }
            installing = true
            worker.execute {
                try {
                    RuntimeHost.prepare(activity)
                    val handler = Handler(Looper.getMainLooper())
                    var completed = false
                    val receiver = object : ResultReceiver(handler) {
                        override fun onReceiveResult(code: Int, data: Bundle?) {
                            if (completed) return
                            completed = true
                            installing = false
                            if (code == 0) invoke.resolve() else invoke.reject(data?.getString("error") ?: "Installer failed: $code")
                        }
                    }
                    activity.startService(Intent(activity, InstallerService::class.java)
                        .putExtra("path", path.absolutePath).putExtra("receiver", receiver))
                    handler.postDelayed({
                        if (!completed) {
                            completed = true
                            installing = false
                            activity.stopService(Intent(activity, InstallerService::class.java))
                            invoke.reject("MiniInstaller timed out. See runtime logs; installation may be incomplete.")
                        }
                    }, 300_000)
                } catch (e: Exception) { installing = false; invoke.reject(e.message) }
            }
        } catch (e: Exception) { invoke.reject(e.message) }
    }

    @Command fun steam(invoke: Invoke) {
        try {
            val args = invoke.getArgs()
            if (args.optString("action") !in listOf("status", "guard", "cancel")) check(!installing) { "请等待 Everest 安装完成" }
            val result = SteamBridge.command(activity.applicationContext, args)
            invoke.resolve(JSObject(result.toString()))
        } catch (e: Exception) { invoke.reject(e.message) }
    }
}
