package com.celemod.runtime

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Serializes downloads, cloud writes, and launch preparation; the game lives in a different process. */
object SteamBridge {
    private val worker = Executors.newSingleThreadExecutor()
    private val active = AtomicBoolean(false)
    private var runtimeStarted = false
    @Volatile private var runtimeError: String? = null
    private val main = Handler(Looper.getMainLooper())
    private var watching = false
    private var initialized = false
    @Volatile var launching = false
    val busy get() = active.get()
    private fun ipc(context: Context) = File(context.filesDir, "steam-ipc").apply { mkdirs() }
    private fun prefs(context: Context) = File(context.filesDir, "steam-settings.json")
    private fun pending(context: Context) = File(context.filesDir, "steam-pending.json")
    private fun links(context: Context) = File(context.filesDir, "steam-links.json")
    @Synchronized fun initialize(context: Context) {
        if (initialized) return
        initialized = true
        clearTransient(context)
        val network = context.getSystemService(android.net.ConnectivityManager::class.java)
        network.registerDefaultNetworkCallback(object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) { main.post { recover(context) } }
        })
    }
    private fun clearTransient(context: Context) {
        for (name in listOf("request.json", "result.json", "guard.json", "cancel", "ready.json"))
            for (suffix in listOf("", ".tmp", ".new", ".bak")) File(ipc(context), name + suffix).delete()
    }
    internal fun json(file: File): JSONObject = if (file.isFile) JSONObject(file.readText()) else JSONObject()
    internal fun atomic(file: File, value: JSONObject) {
        file.parentFile!!.mkdirs()
        val atomic = AtomicFile(file)
        val stream = atomic.startWrite()
        try { stream.write(value.toString().toByteArray()); atomic.finishWrite(stream) }
        catch (e: Throwable) { atomic.failWrite(stream); throw e }
    }
    fun gameRunning(context: Context) = (context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager)
        .runningAppProcesses.orEmpty().any { it.uid == android.os.Process.myUid() && it.processName == context.packageName + ":game" }
    private fun gamePath(context: Context, path: String): File {
        val root = File(context.getExternalFilesDir(null), "games").canonicalFile
        val game = File(path).canonicalFile
        require(game != root && game.toPath().startsWith(root.toPath())) { "游戏目录越界" }
        return game
    }
    private fun state(context: Context, game: File, id: String): File {
        require(id.matches(Regex("[0-9]{17}"))) { "无效的 SteamID" }
        val hash = MessageDigest.getInstance("SHA-256").digest(game.absolutePath.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(context.filesDir, "steam-cloud/$id/$hash")
    }
    fun status(context: Context): JSONObject {
        val result = try { json(File(ipc(context), "status.json")) } catch (_: Exception) { JSONObject() }
        val account = try { SteamVault.read(context) } catch (_: Exception) { null }
        val settings = json(prefs(context))
        result.put("busy", busy).put("account", account?.optString("account") ?: "")
            .put("steamId", account?.optString("steamId") ?: "").put("cloud", settings.optBoolean("cloud", true))
            .put("offline", settings.optBoolean("offline", false)).put("pending", pending(context).isFile)
        val linkedGames = json(links(context))
        val linked = linkedGames.keys().asSequence().firstOrNull { linkedGames.optString(it) == account?.optString("steamId") }
        result.put("game", json(pending(context)).optString("game").ifEmpty { linked ?: "" })
        if (!busy && result.optString("stage") in listOf("connecting", "authenticating", "syncing", "downloading", "manifest", "guard-device", "guard-email", "guard-confirm"))
            result.put("stage", "interrupted").put("message", "上次操作被中断，请重试。未同步存档已保留。")
        runtimeError?.let { result.put("stage", "error").put("message", it) }
        return result
    }
    private fun failure(context: Context, message: String) {
        atomic(File(ipc(context), "status.json"), JSONObject().put("stage", "error").put("message", message))
    }
    @Synchronized private fun ensureRuntime(context: Context) {
        runtimeError?.let { error(it) }
        if (runtimeStarted) return
        val directory = ipc(context)
        // Remove abandoned credentials/results before starting a new in-process host.
        clearTransient(context)
        RuntimeHost.prepare(context)
        runtimeStarted = true
        Thread({
            try { RuntimeHost.runSteam(context, directory); runtimeError = "Steam 运行时已退出，请重启 CeleMod。" }
            catch (e: Throwable) {
                // This is native host initialization, before any credentials are consumed. Never log IPC payloads.
                android.util.Log.e("CeleModSteam", "Native Steam worker failed", e)
                runtimeError = "Steam 运行时启动失败（${e.javaClass.simpleName}），请重启 CeleMod。"
            }
        }, "CeleModSteamCLR").start()
    }
    private fun perform(context: Context, action: String, game: File? = null, args: JSONObject = JSONObject()): JSONObject {
        ensureRuntime(context)
        val dir = ipc(context)
        val readyDeadline = System.currentTimeMillis() + 60_000
        while (!File(dir, "ready.json").exists()) {
            runtimeError?.let { error(it) }
            check(System.currentTimeMillis() < readyDeadline) { "Steam 运行时启动超时" }; Thread.sleep(100)
        }
        val account = if (action in listOf("login", "probe")) args else SteamVault.read(context) ?: error("请先登录 Steam 账号")
        val id = UUID.randomUUID().toString()
        val request = JSONObject().put("job", id).put("action", action).put("account", account.optString("account"))
            .put("clientId", account.optString("clientId", "0"))
            .put("useGuardCode", args.optBoolean("useGuardCode", false))
        if (action == "login") request.put("password", args.getString("password")) else if (action != "probe") request.put("token", account.getString("token"))
        if (game != null) {
            request.put("game", game.absolutePath).put("state", state(context, game, account.getString("steamId")).absolutePath)
            args.optString("choice").takeIf { it.isNotEmpty() }?.let { request.put("choice", it) }
            request.put("phase", args.optString("phase", "manual"))
        }
        File(dir, "cancel").delete(); File(dir, "guard.json").delete(); File(dir, "result.json").delete()
        atomic(File(dir, "request.json"), request)
        request.remove("password"); request.remove("token"); args.remove("password")
        val deadline = System.currentTimeMillis() + 92 * 60_000L
        try {
            while (true) {
                runtimeError?.let { error(it) }
                check(System.currentTimeMillis() < deadline) { "Steam 操作超时，请重启 CeleMod 后重试" }
                val resultFile = File(dir, "result.json")
                if (resultFile.isFile) {
                    val response = json(resultFile)
                    if (response.optString("job") == id) {
                        try {
                            check(response.optBoolean("ok")) { response.optString("error", "Steam 操作失败") }
                            val result = response.getJSONObject("result")
                            if (action == "login") SteamVault.write(context, result)
                            return result.apply { remove("token") }
                        } finally { resultFile.delete() }
                    }
                }
                Thread.sleep(150)
            }
        } finally { File(dir, "request.json").delete(); File(dir, "guard.json").delete() }
    }
    private fun sync(context: Context, game: File, choice: String? = null, phase: String = "manual") {
        val account = SteamVault.read(context) ?: error("Steam 登录已失效；请重新登录，或明确开启离线模式后游玩。")
        val linked = json(links(context)).optString(game.absolutePath)
        require(linked == account.getString("steamId")) { "游戏绑定的是另一个 Steam 账号，请切回该账号。" }
        perform(context, "sync", game, JSONObject().put("phase", phase).apply { if (choice != null) put("choice", choice) })
        if (json(pending(context)).optString("game") == game.absolutePath) pending(context).delete()
    }
    private fun markPending(context: Context, game: File) {
        val previous = json(pending(context)).optString("game")
        check(previous.isEmpty() || previous == game.absolutePath) { "另一个游戏/账号还有待同步存档，请先切回原账号完成同步。" }
        atomic(pending(context), JSONObject().put("game", game.absolutePath))
    }
    private fun service(context: Context, start: Boolean) {
        val intent = Intent(context, SteamTransferService::class.java)
        if (start) context.startForegroundService(intent) else context.stopService(intent)
    }
    private fun exclusive(context: Context, block: () -> Unit) {
        check(active.compareAndSet(false, true)) { "Steam 操作正在进行，请等待完成。" }
        try { service(context, true); block() }
        finally { service(context, false); active.set(false) }
    }
    fun command(context: Context, args: JSONObject): JSONObject {
        val action = args.getString("action")
        when (action) {
            "status" -> return status(context)
            "guard" -> {
                check(busy && status(context).optString("stage") in listOf("guard-device", "guard-email")) { "当前没有验证码请求" }
                val code = args.getString("code").trim()
                require(code.matches(Regex("[a-zA-Z0-9]{5,8}"))) { "验证码格式无效" }
                atomic(File(ipc(context), "guard.json"), JSONObject().put("code", code)); return status(context)
            }
            "cancel" -> { if (busy) File(ipc(context), "cancel").writeText(""); return status(context) }
        }
        check(!gameRunning(context) && !launching && !busy) { "请先退出游戏，并等待当前 Steam 操作完成。" }
        when (action) {
            "settings" -> {
                val value = json(prefs(context))
                for (key in listOf("cloud", "offline")) if (args.has(key)) value.put(key, args.getBoolean(key))
                atomic(prefs(context), value)
                if (!value.optBoolean("offline", false) && value.optBoolean("cloud", true)) recover(context)
            }
            "logout" -> {
                SteamVault.clear(context)
                failure(context, "已退出 Steam；本地游戏和待同步存档保留。重新登录原账号后可继续同步。")
            }
            "login", "probe", "download", "sync", "resolve" -> {
                check(active.compareAndSet(false, true)) { "Steam 操作正在进行" }
                atomic(File(ipc(context), "status.json"), JSONObject().put("stage", "connecting").put("message", "准备 Steam 操作…"))
                worker.execute {
                    try {
                        service(context, true)
                        when (action) {
                            "probe" -> perform(context, "probe")
                            "login" -> perform(context, "login", args = args)
                            "download" -> {
                                val account = SteamVault.read(context) ?: error("请先登录 Steam")
                                val game = gamePath(context, File(context.getExternalFilesDir(null), "games/Steam-${account.getString("steamId")}").absolutePath)
                                val oldPending = json(pending(context)).optString("game")
                                check(oldPending.isEmpty() || oldPending == game.absolutePath) { "其他账号还有待同步存档，请先完成同步。" }
                                perform(context, "download", game)
                                val value = json(links(context)).put(game.absolutePath, account.getString("steamId")); atomic(links(context), value)
                                // Mark pending before first sync, so failures/restarts recover automatically.
                                markPending(context, game)
                                if (json(prefs(context)).optBoolean("cloud", true) && !json(prefs(context)).optBoolean("offline", false)) sync(context, game)
                            }
                            else -> sync(context, gamePath(context, args.getString("game")), args.optString("choice").takeIf { it.isNotEmpty() }, args.optString("phase", "manual"))
                        }
                    } catch (e: Exception) {
                        if (status(context).optString("stage") != "conflict") failure(context, e.message ?: "Steam 操作失败")
                    } finally {
                        args.remove("password"); service(context, false); active.set(false)
                        if (action == "login") main.post { recover(context) }
                    }
                }
            }
            else -> error("未知 Steam 操作")
        }
        return status(context)
    }
    /** Called on the runtime worker, before creating GameActivity. A failed/conflicting sync blocks launch. */
    fun beforeLaunch(context: Context, game: File) {
        val link = json(links(context)).optString(game.absolutePath)
        if (link.isEmpty()) return // ZIP imports retain their previous local-only behavior.
        val settings = json(prefs(context))
        val previous = json(pending(context)).optString("game")
        check(previous.isEmpty() || previous == game.absolutePath) { "其他账号/游戏还有待同步存档，请先完成同步。" }
        if (settings.optBoolean("cloud", true) && !settings.optBoolean("offline", false)) exclusive(context) { sync(context, game, phase = "launch") }
        markPending(context, game)
    }
    /** Poll process liveness, not activity pause: never upload while the game is still writing saves. */
    fun watchGame(context: Context) {
        if (watching) return
        watching = true
        val deadline = System.currentTimeMillis() + 30_000
        var seen = false
        val check = object : Runnable {
            override fun run() {
                if (gameRunning(context)) { seen = true; launching = false; main.postDelayed(this, 1500); return }
                if (!seen && System.currentTimeMillis() < deadline) { main.postDelayed(this, 500); return }
                watching = false; launching = false; recover(context)
            }
        }
        main.post(check)
    }
    fun recover(context: Context) {
        if (gameRunning(context)) { watchGame(context); return }
        if (busy || launching || !pending(context).isFile || !json(prefs(context)).optBoolean("cloud", true) || json(prefs(context)).optBoolean("offline", false)) return
        if (status(context).optString("stage") == "conflict") return // Explicit choice is required; don't dismiss/retry a conflict in the background.
        // Keep the durable pending marker until a confirmed successful sync; no silent cloud failure.
        val game = json(pending(context)).optString("game")
        if (game.isNotEmpty()) try { command(context, JSONObject().put("action", "sync").put("game", game).put("phase", "exit")) }
        catch (e: Exception) { failure(context, e.message ?: "云存档等待重试") }
    }
}
