using System.Reflection;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Security.Cryptography;

// This is only the game's desktop SDK compatibility layer. Authentication,
// ownership checks and real Cloud transfers live in CeleMod.Steam/SteamBridge.
// No game assemblies, Steam credentials or native Steam SDK are bundled here.
internal static class SteamPlatform
{
    internal static void Install()
    {
        if (RuntimeInformation.ProcessArchitecture != Architecture.Arm64) return;
        var game = AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.Combine(AppContext.BaseDirectory, "Celeste.dll"));
        if (!game.GetReferencedAssemblies().Any(a => a.Name == "Steamworks.NET")) return;

        RetargetManagedLibrary(Path.Combine(AppContext.BaseDirectory, "Steamworks.NET.dll"));
        var steam = Assembly.Load("Steamworks.NET");
        void Patch(MethodInfo method, string prefix) => StartupHook.Patch(method, prefix, typeof(SteamPlatform));
        var api = steam.GetType("Steamworks.SteamAPI", true)!;
        Patch(api.GetMethod("Init", Type.EmptyTypes)!, nameof(AllowManagedLaunch));
        Patch(api.GetMethod("RestartAppIfNecessary")!, nameof(Unavailable));
        Patch(api.GetMethod("RunCallbacks", Type.EmptyTypes)!, nameof(SkipDesktopCall));
        Patch(api.GetMethod("Shutdown", Type.EmptyTypes)!, nameof(SkipDesktopCall));
        Patch(steam.GetType("Steamworks.SteamApps", true)!.GetMethod("GetCurrentGameLanguage")!, nameof(DefaultLanguage));

        // Never report an achievement/stat upload as successful: these desktop
        // features are unavailable, unlike the launcher's real save-file sync.
        string[] names = ["GetAchievement", "SetAchievement", "RequestCurrentStats", "GetStat", "SetStat", "GetGlobalStat", "StoreStats"];
        foreach (var method in steam.GetType("Steamworks.SteamUserStats", true)!.GetMethods(BindingFlags.Public | BindingFlags.Static))
            if (method.ReturnType == typeof(bool) && names.Contains(method.Name)) Patch(method, nameof(Unavailable));
        // Avoid starting the game's asynchronous desktop stats request.
        Patch(game.GetType("Celeste.Stats", true)!.GetMethod("MakeRequest", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)!, nameof(SkipDesktopCall));
        Console.WriteLine("[CeleMod] Android Steam game adapter ready. Cloud saves use CeleMod's authenticated sync; desktop achievements/statistics are unavailable.");
    }

    internal static bool RetargetManagedLibrary(string path)
    {
        // MiniInstaller copies a pure-IL Linux x64 Steamworks.NET DLL without
        // NETCoreifier conversion. ARM64 CoreCLR refuses its AMD64 PE header.
        // Restrict adaptation to this exact, unsigned, IL-only 64-bit dependency;
        // never reinterpret native/mixed-mode/R2R code or a 32-bit SDK variant.
        using (var stream = File.OpenRead(path)) {
            using var pe = new PEReader(stream);
            var headers = pe.PEHeaders;
            if (headers.CoffHeader.Machine != Machine.Amd64) return false;
            var cor = headers.CorHeader;
            if (!pe.HasMetadata || cor == null || (cor.Flags & CorFlags.ILOnly) == 0 ||
                (cor.Flags & (CorFlags.Requires32Bit | CorFlags.NativeEntryPoint | CorFlags.StrongNameSigned)) != 0 ||
                cor.ManagedNativeHeaderDirectory.Size != 0 ||
                (headers.CoffHeader.Characteristics & Characteristics.Dll) == 0 ||
                AssemblyName.GetAssemblyName(path).Name != "Steamworks.NET")
                throw new BadImageFormatException("Cannot safely adapt this Steamworks.NET library for Android. Reinstall Everest.");
        }

        var bytes = File.ReadAllBytes(path);
        var backup = Path.Combine(Path.GetDirectoryName(path)!, ".celemod-runtime-backup",
            "Steamworks.NET-" + Convert.ToHexString(SHA256.HashData(bytes)) + ".dll");
        Directory.CreateDirectory(Path.GetDirectoryName(backup)!);
        if (!File.Exists(backup)) File.WriteAllBytes(backup, bytes);
        else if (!File.ReadAllBytes(backup).AsSpan().SequenceEqual(bytes))
            throw new IOException("The Steamworks.NET runtime backup is damaged; original dependency was not modified.");

        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try {
            // Use the runtime's existing Cecil, not a desktop MonoMod bundle.
            var type = Assembly.Load("Mono.Cecil").GetType("Mono.Cecil.ModuleDefinition", true)!;
            using (var module = (IDisposable)type.GetMethod("ReadModule", [typeof(string)])!.Invoke(null, [path])!) {
                var arch = type.GetProperty("Architecture")!;
                arch.SetValue(module, Enum.Parse(arch.PropertyType, "ARM64"));
                type.GetMethod("Write", [typeof(string)])!.Invoke(module, [temporary]);
            }
            using (var pe = new PEReader(File.OpenRead(temporary))) {
                if (pe.PEHeaders.CoffHeader.Machine != Machine.Arm64 || !pe.HasMetadata ||
                    AssemblyName.GetAssemblyName(temporary).FullName != AssemblyName.GetAssemblyName(path).FullName)
                    throw new BadImageFormatException("Steamworks.NET Android adaptation verification failed.");
            }
            File.Move(temporary, path, overwrite: true);
        } finally {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
        Console.WriteLine("[CeleMod] Adapted pure-IL Steamworks.NET from AMD64 to ARM64; original backed up.");
        return true;
    }

    // This return value permits the managed game loop, not a native Steam login.
    private static bool AllowManagedLaunch(ref bool __result) { __result = true; return false; }
    private static bool Unavailable(ref bool __result) { __result = false; return false; }
    private static bool SkipDesktopCall() => false;
    private static bool DefaultLanguage(ref string __result) { __result = "english"; return false; }
}
