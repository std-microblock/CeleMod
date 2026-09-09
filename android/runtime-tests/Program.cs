using System.Reflection;
using System.Reflection.PortableExecutable;
using System.Runtime.Loader;
using Mono.Cecil;

var assertions = 0;
void Check(bool condition, string description) {
    if (!condition) throw new Exception(description);
    assertions++;
}
var root = Path.Combine(Path.GetTempPath(), "celemod-runtime-tests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
try {
    string Fixture(string folder, string name = "Steamworks.NET", TargetArchitecture arch = TargetArchitecture.AMD64) {
        var path = Path.Combine(root, folder, "Steamworks.NET.dll");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var assembly = AssemblyDefinition.CreateAssembly(new AssemblyNameDefinition(name, new Version(2024, 8, 0, 0)), name, ModuleKind.Dll);
        assembly.MainModule.Architecture = arch;
        assembly.Write(path);
        return path;
    }
    var valid = Fixture("valid");
    var original = File.ReadAllBytes(valid);
    Check(SteamPlatform.RetargetManagedLibrary(valid), "x64 pure IL must be adapted");
    using (var pe = new PEReader(File.OpenRead(valid))) {
        Check(pe.PEHeaders.CoffHeader.Machine == Machine.Arm64, "output must target ARM64");
        Check(pe.HasMetadata && (pe.PEHeaders.CorHeader!.Flags & CorFlags.ILOnly) != 0, "output must retain IL metadata");
    }
    Check(AssemblyName.GetAssemblyName(valid).Version == new Version(2024, 8, 0, 0), "preserve assembly identity");
    var backups = Directory.GetFiles(Path.Combine(Path.GetDirectoryName(valid)!, ".celemod-runtime-backup"));
    Check(backups.Length == 1 && File.ReadAllBytes(backups[0]).SequenceEqual(original), "preserve exact original bytes");
    var adapted = File.ReadAllBytes(valid);
    Check(!SteamPlatform.RetargetManagedLibrary(valid), "repeat launch must be idempotent");
    Check(File.ReadAllBytes(valid).SequenceEqual(adapted), "repeat launch must not rewrite library");
    Check(!Directory.GetFiles(Path.GetDirectoryName(valid)!, "*.tmp").Any(), "no leftover temporary files");
    File.WriteAllBytes(valid, original); // Simulate an Everest update restoring x64.
    Check(SteamPlatform.RetargetManagedLibrary(valid), "repair again after installer update");
    Check(Directory.GetFiles(Path.GetDirectoryName(backups[0])!).Length == 1, "deduplicate identical backups");
    File.WriteAllBytes(valid, original);
    File.WriteAllText(backups[0], "damaged backup");
    try { SteamPlatform.RetargetManagedLibrary(valid); throw new Exception("damaged backup accepted"); }
    catch (IOException) { Check(File.ReadAllBytes(valid).SequenceEqual(original), "damaged backup must not modify original"); }

    foreach (var (name, flag) in new[] { ("mixed-mode", CorFlags.ILOnly), ("native-entry", CorFlags.NativeEntryPoint), ("signed", CorFlags.StrongNameSigned), ("32-bit", CorFlags.Requires32Bit) }) {
        var path = Fixture(name);
        var bytes = File.ReadAllBytes(path);
        int offset;
        using (var pe = new PEReader(new MemoryStream(bytes))) offset = pe.PEHeaders.CorHeaderStartOffset + 16;
        var flags = BitConverter.ToInt32(bytes, offset);
        flags = flag == CorFlags.ILOnly ? flags & ~(int)flag : flags | (int)flag;
        BitConverter.GetBytes(flags).CopyTo(bytes, offset);
        File.WriteAllBytes(path, bytes);
        try { SteamPlatform.RetargetManagedLibrary(path); throw new Exception(name + " accepted"); }
        catch (BadImageFormatException) { Check(File.ReadAllBytes(path).SequenceEqual(bytes), name + " remains unchanged"); }
    }
    var foreign = Fixture("foreign", "UnrelatedLibrary");
    try { SteamPlatform.RetargetManagedLibrary(foreign); throw new Exception("foreign library accepted"); }
    catch (BadImageFormatException) { Check(true, "only Steamworks.NET may be retargeted"); }
    var any = Fixture("anycpu", arch: TargetArchitecture.I386);
    var anyBytes = File.ReadAllBytes(any);
    Check(!SteamPlatform.RetargetManagedLibrary(any) && File.ReadAllBytes(any).SequenceEqual(anyBytes), "leave AnyCPU dependency alone");
    foreach (var (method, expected) in new[] { ("AllowManagedLaunch", true), ("Unavailable", false) }) {
        object[] parameters = [!expected];
        var result = typeof(SteamPlatform).GetMethod(method, BindingFlags.NonPublic | BindingFlags.Static)!.Invoke(null, parameters);
        Check(result is false && (bool)parameters[0] == expected, "SDK adapter return semantics: " + method);
    }
    // Resolve a synthetic FNA contract: validate hook targets without shipping
    // game assemblies or loading a desktop graphics/native runtime in CI.
    var fnaPath = Path.Combine(root, "FNA.dll");
    using (var fna = AssemblyDefinition.CreateAssembly(new AssemblyNameDefinition("FNA", new Version(1, 0)), "FNA", ModuleKind.Dll)) {
        var module = fna.MainModule;
        TypeDefinition Type(string name) {
            var type = new TypeDefinition("Microsoft.Xna.Framework.Graphics", name,
                Mono.Cecil.TypeAttributes.Public | Mono.Cecil.TypeAttributes.Class, module.TypeSystem.Object);
            module.Types.Add(type);
            return type;
        }
        var adapter = Type("GraphicsAdapter");
        var profile = Type("GraphicsProfile");
        var parameters = Type("PresentationParameters");
        var device = Type("GraphicsDevice");
        void Method(string name, params TypeDefinition[] arguments) {
            var flags = Mono.Cecil.MethodAttributes.Public;
            if (name == ".ctor") flags |= Mono.Cecil.MethodAttributes.SpecialName | Mono.Cecil.MethodAttributes.RTSpecialName;
            var method = new MethodDefinition(name, flags, module.TypeSystem.Void);
            foreach (var argument in arguments) method.Parameters.Add(new ParameterDefinition(argument));
            method.Body.Instructions.Add(Mono.Cecil.Cil.Instruction.Create(Mono.Cecil.Cil.OpCodes.Ret));
            device.Methods.Add(method);
        }
        Method(".ctor", adapter, profile, parameters);
        Method("Reset", parameters, adapter);
        Method("Reset", parameters);
        Method("Reset");
        fna.Write(fnaPath);
    }
    Assembly? ResolveFna(AssemblyLoadContext context, AssemblyName name) {
        if (name.Name != "FNA") return null;
        using var stream = File.OpenRead(fnaPath);
        return context.LoadFromStream(stream); // Do not lock the temporary DLL on Windows.
    }
    AssemblyLoadContext.Default.Resolving += ResolveFna;
    try { GameDisplay.Install(); }
    finally { AssemblyLoadContext.Default.Resolving -= ResolveFna; }
    Check(StartupHook.Patches.Count == 2, "install both startup and reset sizing hooks");
    Check(StartupHook.Patches[0].Method is ConstructorInfo && StartupHook.Patches[0].Prefix == "BeforeCreate",
        "patch graphics construction for launching with fullscreen already disabled");
    Check(StartupHook.Patches[1].Method.Name == "Reset" && StartupHook.Patches[1].Method.GetParameters().Length == 2,
        "patch the shared reset overload for fullscreen and resize changes");
    foreach (var (method, prefix, owner) in StartupHook.Patches) {
        var hook = owner.GetMethod(prefix, BindingFlags.NonPublic | BindingFlags.Static)!;
        Check(hook.GetParameters()[0].Name == (method is ConstructorInfo ? "__2" : "__0"),
            "bind the presentation parameters by position");
        hook.Invoke(null, new object?[] { null });
        hook.Invoke(null, new object[] { new DisplayParameters { DeviceWindowHandle = IntPtr.Zero } });
        Check(true, "null parameters and missing windows never call native SDL");
    }

    foreach (var fullscreen in new[] { false, true }) {
        var parameters = new DisplayParameters { IsFullScreen = fullscreen };
        foreach (var (width, height) in new[] { (2400, 1080), (2268, 984), (1920, 1080), (1080, 2268), (1600, 900) }) {
            Check(GameDisplay.MatchBackBuffer(parameters, width, height), "surface resize adjusts backbuffer");
            Check(parameters.BackBufferWidth == width && parameters.BackBufferHeight == height,
                "use drawable pixels, including system bars, rotation and 16:9 displays");
            Check(parameters.IsFullScreen == fullscreen && parameters.PresentationInterval == 1 && parameters.DeviceWindowHandle == (IntPtr)123,
                "preserve fullscreen preference, vsync and window handle");
            Check(!GameDisplay.MatchBackBuffer(parameters, width, height), "matching backbuffer is unchanged");
        }
        foreach (var (width, height) in new[] { (0, 0), (2400, 0), (0, 1080), (-1, 1080) })
            Check(!GameDisplay.MatchBackBuffer(parameters, width, height) &&
                parameters.BackBufferWidth == 1600 && parameters.BackBufferHeight == 900,
                "unavailable drawable preserves valid dimensions");
    }
    InstallerTests.Run(root, Check);
    Console.WriteLine($"PASS: {assertions} Android runtime assertions");
} finally { Directory.Delete(root, recursive: true); }

// Record patch registrations; tests never install Harmony or load game binaries.
internal static class StartupHook {
    internal static readonly List<(MethodBase Method, string Prefix, Type Owner)> Patches = new();
    internal static void Patch(MethodBase method, string prefix, Type owner) => Patches.Add((method, prefix, owner));
}

internal sealed class DisplayParameters {
    public int BackBufferWidth { get; set; } = 960;
    public int BackBufferHeight { get; set; } = 540;
    public bool IsFullScreen { get; set; }
    public int PresentationInterval { get; set; } = 1;
    public IntPtr DeviceWindowHandle { get; set; } = (IntPtr)123;
}
