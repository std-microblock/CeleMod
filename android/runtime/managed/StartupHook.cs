using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.Loader;

// Additional Android adaptations, layered after RAL's pinned startup hook.
// No references to, or redistribution of, proprietary game assemblies.
internal static class StartupHook
{
    public static void Initialize()
    {
        if (Environment.GetEnvironmentVariable("CELEMOD_INSTALLER") == "1") InstallerLog.Install();
        InstallerDependencies.Prepare(AppContext.BaseDirectory,
            Environment.GetEnvironmentVariable("MONOMOD_PATH")!);
        // Run the pinned RAL hook after selecting the edition-specific dependencies.
        var ralHook = Environment.GetEnvironmentVariable("CELEMOD_RAL_HOOK");
        if (!string.IsNullOrEmpty(ralHook)) {
            var assembly = AssemblyLoadContext.Default.LoadFromAssemblyPath(ralHook);
            assembly.GetType("StartupHook", true)!.GetMethod("Initialize", BindingFlags.Public | BindingFlags.Static)!.Invoke(null, null);
        }
        if (Environment.GetEnvironmentVariable("CELEMOD_INSTALLER") == "1")
            PatchInstaller();
        else {
            SteamPlatform.Install();
            GameDisplay.Install();
            PatchGameProgress();
            GameControls.Install();
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void PatchInstaller()
    {
        var installer = AssemblyLoadContext.Default.LoadFromAssemblyPath(
            Path.Combine(AppContext.BaseDirectory, "MiniInstaller.dll"));
        var method = installer.GetType("MiniInstaller.LibAndDepHandling", throwOnError: true)!
            .GetMethod("SetupAppHosts", BindingFlags.Public | BindingFlags.Static,
                null, new[] { typeof(string), typeof(string), typeof(string) }, null)
            ?? throw new MissingMethodException("MiniInstaller.LibAndDepHandling.SetupAppHosts");
        Patch(method, nameof(SkipDesktopAppHosts));
        Console.WriteLine("[CeleMod] Android apphost adaptation installed.");
    }

    internal static void Patch(MethodBase method, string prefixName, Type? owner = null, bool postfix = false)
    {
        // Resolve RAL's net10 Harmony at runtime; the hook itself builds with a stock
        // .NET 8 SDK and does not accidentally bundle desktop MonoMod dependencies.
        var harmonyAssembly = Assembly.Load("0Harmony");
        var harmonyType = harmonyAssembly.GetType("HarmonyLib.Harmony", true)!;
        var methodType = harmonyAssembly.GetType("HarmonyLib.HarmonyMethod", true)!;
        var harmony = Activator.CreateInstance(harmonyType, "cc.microblock.celemod.android")!;
        var prefix = Activator.CreateInstance(methodType, (owner ?? typeof(StartupHook))
            .GetMethod(prefixName, BindingFlags.NonPublic | BindingFlags.Static)!)!;
        var patch = harmonyType.GetMethods().Single(m => m.Name == "Patch" && m.GetParameters()[0].ParameterType == typeof(MethodBase));
        var arguments = new object?[patch.GetParameters().Length];
        arguments[0] = method;
        arguments[postfix ? 2 : 1] = prefix;
        patch.Invoke(harmony, arguments);
    }

    private static void PatchGameProgress()
    {
        try {
            var game = AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.Combine(AppContext.BaseDirectory, "Celeste.dll"));
            var splash = game.GetType("Celeste.Mod.EverestSplashHandler");
            if (splash == null) { WriteProgress("unsupported"); return; }
            var send = splash.GetMethod("SendMessageToSplash", BindingFlags.NonPublic | BindingFlags.Static,
                null, new[] { typeof(string) }, null) ?? throw new MissingMethodException("SendMessageToSplash");
            var stop = splash.GetMethod("StopSplash", BindingFlags.Public | BindingFlags.Static)
                ?? throw new MissingMethodException("StopSplash");
            Patch(send, nameof(SplashMessage));
            Patch(stop, nameof(SplashReady));
            WriteProgress("boot");
            Console.WriteLine("[CeleMod] Native loading overlay connected to Everest splash progress.");
        } catch (Exception e) {
            Console.WriteLine("[CeleMod] Splash progress unavailable: " + e);
            WriteProgress("unsupported");
        }
    }

    private static bool SplashMessage(string __0)
    {
        if (__0.StartsWith("#progress", StringComparison.Ordinal)) {
            var parts = __0[9..].Split(';', 3);
            if (parts.Length == 3 && int.TryParse(parts[0], out var loaded) && int.TryParse(parts[1], out var total))
                WriteProgress("mods", loaded, total, parts[2]);
        } else if (__0.StartsWith("#finish", StringComparison.Ordinal)) {
            WriteProgress("resources");
        }
        return false; // APK overlay replaces the desktop pipe/process, never spawns it.
    }

    private static void SplashReady() => WriteProgress("ready");

    private static readonly object ProgressLock = new();
    private static void WriteProgress(string stage, int loaded = 0, int total = 0, string detail = "")
    {
        var path = Environment.GetEnvironmentVariable("CELEMOD_PROGRESS_PATH");
        if (string.IsNullOrEmpty(path)) return;
        try {
            lock (ProgressLock) {
                var json = System.Text.Json.JsonSerializer.Serialize(new { stage, loaded, total, detail });
                File.WriteAllText(path + ".tmp", json);
                File.Move(path + ".tmp", path, overwrite: true);
            }
        } catch (IOException) { /* Loading progress must not prevent the game from starting. */ }
    }

    private static bool SkipDesktopAppHosts()
    {
        // Android enters Celeste.dll through the APK's hostfxr JNI. Desktop ELF/PE
        // launchers cannot execute on shared storage and chmod fails on its FUSE mount.
        // Keep the real conversion, MonoMod patches, deps/runtimeconfig, and cleanup.
        Console.WriteLine("[CeleMod] Skipping desktop apphosts; using embedded Android hostfxr.");
        return false;
    }
}
