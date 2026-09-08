package com.celemod.runtime

import android.content.Context
import android.system.Os
import android.system.OsConstants
import android.util.Log
import com.app.ralaunch.core.common.util.NativeMethods
import com.app.ralaunch.core.platform.runtime.dotnet.CoreHostHooks
import com.app.ralaunch.core.platform.runtime.dotnet.DotNetLauncher
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.tukaani.xz.XZInputStream
import java.io.File
import java.util.zip.ZipInputStream

/** CeleMod's feature-scoped fork of RAL's runtime setup; never copies game data into APK assets. */
object RuntimeHost {
    private const val VERSION = "ral-2.1.1-dotnet-10.0.4"
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
    @Synchronized fun prepare(context: Context) {
        val root = runtimeRoot(context)
        // Refresh the small CeleMod hook independently of the pinned runtime archive.
        root.mkdirs()
        context.assets.open("CeleMod.Android.dll").use { input ->
            File(root, "CeleMod.Android.dll").outputStream().use { input.copyTo(it) }
        }
        if (File(root, ".ready").isFile) return
        root.mkdirs()
        // Private internal storage is required: Android shared storage is mounted noexec.
        TarArchiveInputStream(XZInputStream(context.assets.open("dotnet.tar.xz"))).use { tar ->
            while (true) {
                val entry = tar.nextEntry ?: break
                require(!entry.isSymbolicLink && !entry.isLink) { "Unexpected runtime archive link" }
                val out = safeTarget(root, entry.name)
                if (entry.isDirectory) out.mkdirs() else {
                    out.parentFile!!.mkdirs()
                    out.outputStream().use { tar.copyTo(it) }
                    if (out.name.endsWith(".so") || out.name == "dotnet") out.setExecutable(true, true)
                }
            }
        }
        unzip(context, "MonoMod.zip", File(root, "monomod"))
        unzip(context, "patches/com.app.ralaunch.everest.fix.zip", File(root, "everest"))
        unzip(context, "patches/com.app.ralaunch.everest.miniinstaller.fix.zip", File(root, "installer"))
        File(root, ".ready").writeText(VERSION)
    }

    private fun installMonoMod(context: Context, game: File) {
        // RAL's Android-compatible MonoMod build must also replace the installer's
        // deps.json-resolved copies. Do not rewrite user Mods or vanilla backups.
        val replacements = File(runtimeRoot(context), "monomod").listFiles()!!.associateBy { it.name }
        val targets = (game.listFiles()?.filter { it.isFile } ?: emptyList()) +
            File(game, "everest-lib").walkTopDown().filter { it.isFile }.toList()
        for (target in targets) {
            val replacement = replacements[target.name] ?: continue
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

    fun run(context: Context, assembly: File, installer: Boolean, vanilla: Boolean = false, legacy: Boolean = false): Int {
        val root = runtimeRoot(context)
        check(File(root, ".ready").isFile) { "Runtime has not been prepared" }
        require(assembly.isFile) { "Missing managed assembly: $assembly" }
        configureGameStorage(assembly.parentFile!!)
        if (installer) installMonoMod(context, assembly.parentFile!!)
        val logs = File(context.getExternalFilesDir(null), "logs").apply { mkdirs() }
        val log = File(logs, if (installer) "installer.log" else "game.log")
        val fd = Os.open(log.absolutePath, OsConstants.O_WRONLY or OsConstants.O_CREAT or OsConstants.O_TRUNC, 384)
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
        if (!installer) {
            env("CELEMOD_PROGRESS_PATH", File(context.cacheDir, "game-progress-${android.os.Process.myPid()}.json").absolutePath)
            env("CELEMOD_CONTROLS_PATH", File(context.cacheDir, "game-controls-${android.os.Process.myPid()}.json").absolutePath)
        }
        env("DOTNET_STARTUP_HOOKS", File(root, hook).absolutePath + ":" + File(root, "CeleMod.Android.dll").absolutePath)
        for (lib in arrayOf("c++_shared", "fmodL", "fmod", "fmodstudioL", "fmodstudio", "dotnethost", "FAudio", "theorafile", "SDL2", "main", "FNA3D", "lua54")) {
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
