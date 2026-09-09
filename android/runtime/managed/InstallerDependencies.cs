using System.Reflection;
using System.Runtime.Loader;
using System.Security.Cryptography;
using System.Reflection.PortableExecutable;

// Keep Ultra's managed transaction implementation, but use RAL's Android-capable
// MonoMod.Core/Utils underneath it. Replacing RuntimeDetour loses Ultra-only APIs.
internal static class InstallerDependencies
{
    internal static bool Prepare(string game, string runtime)
    {
        var path = Path.Combine(game, "MonoMod.RuntimeDetour.dll");
        if (!File.Exists(path)) return false;
        AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.Combine(runtime, "Mono.Cecil.dll"));
        if (!AdaptUltraLibrary(path, Path.Combine(runtime, "MonoMod.RuntimeDetour.dll"))) return false;
        // Load before RAL's Harmony resolves RuntimeDetour from MONOMOD_PATH.
        AssemblyLoadContext.Default.LoadFromAssemblyPath(path);
        Console.WriteLine("[CeleMod] Preserved EverestUltra ILHookTransaction with the Android MonoMod backend.");
        return true;
    }

    internal static bool AdaptUltraLibrary(string path, string runtimeLibrary)
    {
        var moduleType = Assembly.Load("Mono.Cecil").GetType("Mono.Cecil.ModuleDefinition", true)!;
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try {
            using (var module = (IDisposable)moduleType.GetMethod("ReadModule", [typeof(string)])!.Invoke(null, [path])!) {
                if (moduleType.GetMethod("GetType", [typeof(string)])!.Invoke(module, ["MonoMod.RuntimeDetour.ILHookTransaction"]) == null)
                    return false;
                var name = AssemblyName.GetAssemblyName(path);
                if (name.Name != "MonoMod.RuntimeDetour" || name.GetPublicKeyToken() is { Length: > 0 })
                    throw new NotSupportedException("Expected an unsigned MonoMod.RuntimeDetour library for Ultra adaptation.");
                using (var pe = new PEReader(File.OpenRead(path))) {
                    var cor = pe.PEHeaders.CorHeader;
                    if (cor == null || (cor.Flags & CorFlags.ILOnly) == 0 ||
                        (cor.Flags & (CorFlags.NativeEntryPoint | CorFlags.StrongNameSigned)) != 0 ||
                        cor.ManagedNativeHeaderDirectory.Size != 0)
                        throw new BadImageFormatException("Ultra RuntimeDetour must contain only managed IL.");
                }
                var minimum = AssemblyName.GetAssemblyName(runtimeLibrary).Version!;
                if (name.Version! < minimum) {
                    // RAL's Harmony requests its build's assembly version. The managed
                    // RuntimeDetour API is compatible; the actual Android backend stays RAL's.
                    var bytes = File.ReadAllBytes(path);
                    var backup = Path.Combine(Path.GetDirectoryName(path)!, ".celemod-runtime-backup",
                        "Ultra-RuntimeDetour-" + Convert.ToHexString(SHA256.HashData(bytes)) + ".dll");
                    Directory.CreateDirectory(Path.GetDirectoryName(backup)!);
                    if (!File.Exists(backup)) File.Copy(path, backup);
                    else if (!File.ReadAllBytes(backup).AsSpan().SequenceEqual(bytes))
                        throw new IOException("The Ultra RuntimeDetour backup is damaged; original dependency was not modified.");
                    var assembly = moduleType.GetProperty("Assembly")!.GetValue(module)!;
                    var definition = assembly.GetType().GetProperty("Name")!.GetValue(assembly)!;
                    definition.GetType().GetProperty("Version")!.SetValue(definition, minimum);
                    moduleType.GetMethod("Write", [typeof(string)])!.Invoke(module, [temporary]);
                    if (AssemblyName.GetAssemblyName(temporary).Version != minimum)
                        throw new BadImageFormatException("Ultra RuntimeDetour adaptation verification failed.");
                }
            }
            if (File.Exists(temporary)) File.Move(temporary, path, overwrite: true);
        } finally {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
        return true;
    }
}
