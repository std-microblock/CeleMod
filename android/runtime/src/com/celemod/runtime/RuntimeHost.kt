package com.celemod.runtime

import android.content.Context
import android.system.Os
import android.system.OsConstants
import android.util.Log
import com.app.ralaunch.core.common.util.NativeMethods
import com.app.ralaunch.core.platform.runtime.dotnet.CoreHostHooks
import com.app.ralaunch.core.platform.runtime.dotnet.DotNetLauncher
import org.tukaani.xz.XZInputStream
import java.io.BufferedInputStream
import java.io.EOFException
import java.io.File
import java.io.InputStream
import java.util.zip.ZipInputStream

/** CeleMod's feature-scoped fork of RAL's runtime setup; never copies game data into APK assets. */
object RuntimeHost {
    private const val VERSION = "ral-2.1.1-dotnet-10.0.4-slim3"
    private const val TAR_BLOCK_SIZE = 512
    fun runtimeRoot(context: Context) = File(context.filesDir, VERSION)
    private fun safeTarget(root: File, name: String): File {
        val file = File(root, name).canonicalFile
        require(file.toPath().startsWith(root.canonicalFile.toPath())) { "Unsafe archive entry: $name" }
        return file
    }
    private fun unzip(context: Context, asset: String, root: File) {
        ZipInputStream(context.assets.open(asset)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val out = safeTarget(root, entry.name)
                if (entry.isDirectory) out.mkdirs() else {
                    out.parentFile!!.mkdirs()
                    out.outputStream().use { zip.copyTo(it) }
                }
            }
        }
    }

    private fun InputStream.readBlock(block: ByteArray): Boolean {
        var offset = 0
        while (offset < block.size) {
            val count = read(block, offset, block.size - offset)
            if (count < 0) {
                if (offset == 0) return false
                throw EOFException("Truncated runtime archive header")
            }
            // InputStream is allowed to return zero without reaching EOF.
            // Make progress explicitly instead of spinning forever.
            if (count == 0) {
                val value = read()
                if (value < 0) {
                    if (offset == 0) return false
                    throw EOFException("Truncated runtime archive header")
                }
                block[offset++] = value.toByte()
            } else {
                offset += count
            }
        }
        return true
    }

    private fun tarString(block: ByteArray, offset: Int, length: Int): String {
        val end = (offset until offset + length).firstOrNull { block[it].toInt() == 0 } ?: offset + length
        return block.copyOfRange(offset, end).toString(Charsets.UTF_8)
    }

    private fun tarSize(block: ByteArray): Long {
        val value = tarString(block, 124, 12).trim()
        require(value.isNotEmpty() && value.all { it in '0'..'7' }) { "Invalid runtime archive size" }
        return value.toLong(8)
    }

    private fun InputStream.copyExactly(output: java.io.OutputStream, length: Long) {
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var remaining = length
        while (remaining > 0) {
            val count = read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
            if (count < 0) throw EOFException("Truncated runtime archive entry")
            output.write(buffer, 0, count)
            remaining -= count
        }
    }

    private fun InputStream.skipExactly(length: Long) {
        var remaining = length
        while (remaining > 0) {
            val count = skip(remaining)
            if (count > 0) remaining -= count
            else if (read() >= 0) remaining--
            else throw EOFException("Truncated runtime archive padding")
        }
    }

    private fun untarAsset(context: Context, asset: String, root: File) {
        BufferedInputStream(XZInputStream(context.assets.open(asset))).use { tar ->
            val block = ByteArray(TAR_BLOCK_SIZE)
            while (tar.readBlock(block)) {
                if (block.all { it.toInt() == 0 }) break
                val name = tarString(block, 0, 100)
                val prefix = tarString(block, 345, 155)
                val path = if (prefix.isEmpty()) name else "$prefix/$name"
                val type = block[156].toInt().toChar()
                val size = tarSize(block)
                val out = safeTarget(root, path)
                when (type) {
                    '\u0000', '0' -> {
                        out.parentFile!!.mkdirs()
                        out.outputStream().use { tar.copyExactly(it, size) }
                        if (out.name.endsWith(".so") || out.name == "dotnet") out.setExecutable(true, true)
                    }
                    '5' -> {
                        require(size == 0L) { "Invalid runtime directory entry" }
                        out.mkdirs()
                    }
                    '1', '2' -> error("Unexpected runtime archive link: $path")
                    else -> error("Unsupported runtime archive entry type $type: $path")
                }
                tar.skipExactly((TAR_BLOCK_SIZE - size % TAR_BLOCK_SIZE) % TAR_BLOCK_SIZE)
            }
        }
    }

    @Synchronized fun prepare(context: Context) {
        val root = runtimeRoot(context)
        // Refresh the small CeleMod hook independently of the pinned runtime archive.
        root.mkdirs()
        context.assets.open("CeleMod.Android.dll").use { input ->
            File(root, "CeleMod.Android.dll").outputStream().use { input.copyTo(it) }
        }
        if (!File(root, ".ready").isFile) {
            // Private internal storage is required: Android shared storage is mounted noexec.
            untarAsset(context, "dotnet.tar.xz", root)
            untarAsset(context, "monomod.tar.xz", root)
            unzip(context, "patches/com.app.ralaunch.everest.fix.zip", File(root, "everest"))
            unzip(context, "patches/com.app.ralaunch.everest.miniinstaller.fix.zip", File(root, "installer"))
            File(root, ".ready").writeText(VERSION)
        }
        // An APK update must refresh the worker even when CoreCLR is already
        // extracted. Keep account credentials and cloud baselines untouched.
        val steamReady = File(root, ".steam-ready")
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        context.assets.open("steam.tar.xz").use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        val steamVersion = digest.digest().joinToString("") { "%02x".format(it) }
        if (!steamReady.isFile || steamReady.readText() != steamVersion) {
            untarAsset(context, "steam.tar.xz", root)
            steamReady.writeText(steamVersion)
        }
    }

    private fun installMonoMod(context: Context, game: File) {
        // RAL's Android-compatible MonoMod build must also replace the installer's
        // deps.json-resolved copies. Do not rewrite user Mods or vanilla backups.
        val replacements = File(runtimeRoot(context), "monomod").listFiles()!!.associateBy { it.name }
        val targets = (game.listFiles()?.filter { it.isFile } ?: emptyList()) +
            File(game, "everest-lib").walkTopDown().filter { it.isFile }.toList()
        for (target in targets) {
            val replacement = replacements[target.name] ?: continue
            // Ultra extends RuntimeDetour with ILHookTransaction. Keep that managed
            // implementation; the startup hook binds it to RAL's Android Core/Utils.
            if (target.name == "MonoMod.RuntimeDetour.dll" &&
                target.readBytes().toString(Charsets.ISO_8859_1).contains("ILHookTransaction")) continue
            val backup = File(game, ".celemod-runtime-backup/${target.relativeTo(game)}")
            if (!backup.exists()) { backup.parentFile!!.mkdirs(); target.copyTo(backup) }
            replacement.copyTo(target, overwrite = true)
        }
    }

    fun configureGameStorage(game: File) {
        // CeleMod manages this game's Mods/, not RAL's shared XDG Everest/Mods.
        // Preserve the old marker so this migration is reversible.
        val flag = File(game, "EverestXDGFlag")
        if (flag.isFile) {
            val backup = File(game, ".celemod-runtime-backup/EverestXDGFlag")
            backup.parentFile!!.mkdirs()
            if (!backup.exists()) flag.copyTo(backup)
            check(flag.delete()) { "Cannot configure per-game Mod storage" }
        }
    }

    /** Network-only worker in the manager process. Never chdir, redirect stdio, initialize SDL, or install game hooks here. */
    fun runSteam(context: Context, ipc: File): Int {
        val root = runtimeRoot(context)
        val steam = File(root, "steam")
        val assembly = File(steam, "CeleMod.Steam.dll")
        check(assembly.isFile) { "Steam worker assets are missing; rebuild the APK" }
        Os.setenv("DOTNET_ROOT", root.absolutePath, true)
        Os.setenv("DOTNET_ROLL_FORWARD", "LatestMajor", true)
        Os.setenv("DOTNET_SYSTEM_GLOBALIZATION_INVARIANT", "1", true)
        Os.setenv("DOTNET_EnableDiagnostics", "0", true)
        Os.setenv("RALCORE_NATIVEDIR", context.applicationInfo.nativeLibraryDir, true)
        System.loadLibrary("c++_shared")
        System.loadLibrary("dotnethost")
        // RAL exposes the hostfxr JNI entry points from libmain, whose link dependencies include SDL/FNA.
        // Loading these libraries does not start an SDL Activity, renderer, audio device or game.
        System.loadLibrary("SDL2")
        System.loadLibrary("main")
        CoreHostHooks.nativeInitCoreHostCompatHooks()
        val shared = File(root, "shared/Microsoft.NETCore.App/10.0.4")
        for (lib in arrayOf("libSystem.Native.so", "libSystem.IO.Compression.Native.so", "libSystem.Security.Cryptography.Native.Android.so"))
            System.load(File(shared, lib).absolutePath)
        return DotNetLauncher.nativeDotNetLauncherHostfxrLaunch(assembly.absolutePath, arrayOf(ipc.absolutePath), root.absolutePath)
    }

    fun run(context: Context, assembly: File, installer: Boolean, vanilla: Boolean = false, legacy: Boolean = false): Int {
        val root = runtimeRoot(context)
        check(File(root, ".ready").isFile) { "Runtime has not been prepared" }
        require(assembly.isFile) { "Missing managed assembly: $assembly" }
        configureGameStorage(assembly.parentFile!!)
        if (installer) installMonoMod(context, assembly.parentFile!!)
        val logs = File(context.getExternalFilesDir(null), "logs").apply { mkdirs() }
        val log = File(logs, if (installer) "installer.log" else "game.log")
        val fd = Os.open(log.absolutePath, OsConstants.O_WRONLY or OsConstants.O_CREAT or
            (if (installer) OsConstants.O_APPEND else OsConstants.O_TRUNC), 384)
        Os.dup2(fd, 1); Os.dup2(fd, 2); Os.close(fd)
        val nativeDir = context.applicationInfo.nativeLibraryDir
        fun env(k: String, v: String) = Os.setenv(k, v, true)
        env("DOTNET_ROOT", root.absolutePath)
        env("DOTNET_ROLL_FORWARD", "LatestMajor")
        env("DOTNET_ROLL_FORWARD_TO_PRERELEASE", "1")
        env("DOTNET_SYSTEM_GLOBALIZATION_INVARIANT", "1")
        env("DOTNET_EnableDiagnostics", "0")
        env("DOTNET_gcConcurrent", "0")
        env("DOTNET_TieredCompilation", "0")
        env("DOTNET_TC_QuickJit", "0")
        env("DOTNET_Thread_DefaultStackSize", "100000")
        env("RAL_CORECLR_XIAOMI_COMPAT", "1")
        env("MONOMOD_PATH", File(root, "monomod").absolutePath)
        env("RALCORE_NATIVEDIR", nativeDir)
        env("FNA3D_OPENGL_DRIVER", "native")
        env("FNA3D_FORCE_DRIVER", "OpenGL")
        env("FNA3D_OPENGL_FORCE_ES3", "1")
        env("FNA3D_OPENGL_FORCE_VER_MAJOR", "3")
        env("FNA3D_OPENGL_FORCE_VER_MINOR", "0")
        env("SDL_ORIENTATIONS", "LandscapeLeft LandscapeRight")
        env("SDL_TOUCH_MOUSE_EVENTS", "0")
        env("SDL_MOUSE_TOUCH_EVENTS", "0")
        env("EVEREST_NO_RESTART", "1")
        env("EVEREST_SAVEPATH", assembly.parent!!)
        if (legacy) {
            env("EVEREST_PARALLEL_LOAD", "0")
            env("EVEREST_ILHOOK_STARTUP_TRANSACTION", "0")
            env("EVEREST_LOADER_PGO_REORDER", "0")
        }
        val hook = if (installer) "installer/EverestMiniInstallerPatch.dll" else "everest/EverestPatch.dll"
        env("CELEMOD_INSTALLER", if (installer) "1" else "0")
        if (installer) env("CELEMOD_INSTALLER_LOG", log.absolutePath)
        if (!installer) {
            env("CELEMOD_PROGRESS_PATH", File(context.cacheDir, "game-progress-${android.os.Process.myPid()}.json").absolutePath)
            env("CELEMOD_CONTROLS_PATH", File(context.cacheDir, "game-controls-${android.os.Process.myPid()}.json").absolutePath)
        }
        env("CELEMOD_RAL_HOOK", File(root, hook).absolutePath)
        env("DOTNET_STARTUP_HOOKS", File(root, "CeleMod.Android.dll").absolutePath)
        for (lib in arrayOf("c++_shared", "fmod", "fmodstudio", "dotnethost", "FAudio", "theorafile", "SDL2", "main", "FNA3D", "lua54", "cimgui")) {
            System.loadLibrary(lib)
        }
        org.fmod.FMOD.init(context)
        CoreHostHooks.nativeInitCoreHostCompatHooks()
        val shared = File(root, "shared/Microsoft.NETCore.App/10.0.4")
        for (lib in arrayOf("libSystem.Native.so", "libSystem.IO.Compression.Native.so", "libSystem.Security.Cryptography.Native.Android.so")) {
            System.load(File(shared, lib).absolutePath)
        }
        check(NativeMethods.nativeChdir(assembly.parent!!) == 0) { "Cannot enter game directory" }
        val config = File(assembly.parentFile, assembly.nameWithoutExtension + ".runtimeconfig.json")
        if (!config.isFile) config.writeText("""{"runtimeOptions":{"tfm":"net10.0","framework":{"name":"Microsoft.NETCore.App","version":"10.0.4"}}}""")
        Log.i("CeleModRuntime", "Launching $assembly installer=$installer vanilla=$vanilla")
        val args = if (installer) emptyArray() else if (vanilla) arrayOf("--disable-splash", "--vanilla") else arrayOf("--disable-splash")
        val code = DotNetLauncher.nativeDotNetLauncherHostfxrLaunch(assembly.absolutePath, args, root.absolutePath)
        if (code != 0) Log.e("CeleModRuntime", DotNetLauncher.getNativeDotNetLauncherHostfxrLastErrorMsg())
        return code
    }
}
