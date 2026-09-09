using System.Reflection;
using Mono.Cecil;
using System.Reflection.PortableExecutable;

internal static class InstallerTests
{
    internal static void Run(string root, Action<bool, string> check)
    {
        var folder = Path.Combine(root, "installer");
        Directory.CreateDirectory(folder);
        string Fixture(string name, Version version, bool ultra) {
            var path = Path.Combine(folder, name + ".dll");
            using var assembly = AssemblyDefinition.CreateAssembly(new AssemblyNameDefinition("MonoMod.RuntimeDetour", version), "MonoMod.RuntimeDetour", ModuleKind.Dll);
            if (ultra) assembly.MainModule.Types.Add(new TypeDefinition("MonoMod.RuntimeDetour", "ILHookTransaction", Mono.Cecil.TypeAttributes.Public, assembly.MainModule.TypeSystem.Object));
            assembly.Write(path);
            return path;
        }
        var android = Fixture("android", new Version(25, 3, 3, 0), false);
        var official = Fixture("official", new Version(25, 3, 1, 0), false);
        var bytes = File.ReadAllBytes(official);
        check(!InstallerDependencies.AdaptUltraLibrary(official, android), "official dependencies are not retargeted");
        check(bytes.SequenceEqual(File.ReadAllBytes(official)), "official bytes remain unchanged");
        var ultra = Fixture("ultra", new Version(25, 3, 1, 0), true);
        bytes = File.ReadAllBytes(ultra);
        check(InstallerDependencies.AdaptUltraLibrary(ultra, android), "detect and adapt Ultra transaction dependency");
        check(AssemblyName.GetAssemblyName(ultra).Version == new Version(25, 3, 3, 0), "satisfy Android Harmony assembly binding");
        using (var module = ModuleDefinition.ReadModule(ultra))
            check(module.GetType("MonoMod.RuntimeDetour.ILHookTransaction") != null, "retain actual Ultra transaction type");
        var backups = Directory.GetFiles(Path.Combine(folder, ".celemod-runtime-backup"));
        check(backups.Length == 1 && bytes.SequenceEqual(File.ReadAllBytes(backups[0])), "back up exact Ultra bytes");
        var adapted = File.ReadAllBytes(ultra);
        check(InstallerDependencies.AdaptUltraLibrary(ultra, android) && adapted.SequenceEqual(File.ReadAllBytes(ultra)), "repeat launch is idempotent");
        File.WriteAllBytes(ultra, bytes);
        check(InstallerDependencies.AdaptUltraLibrary(ultra, android), "reinstall restoring old version is repaired");
        check(Directory.GetFiles(Path.Combine(folder, ".celemod-runtime-backup")).Length == 1, "deduplicate backups");
        File.WriteAllBytes(ultra, bytes);
        File.WriteAllText(backups[0], "damaged");
        try { InstallerDependencies.AdaptUltraLibrary(ultra, android); throw new Exception("Accepted damaged backup"); }
        catch (IOException) { check(bytes.SequenceEqual(File.ReadAllBytes(ultra)), "damaged backup leaves original untouched"); }
        var newer = Fixture("newer", new Version(25, 4, 0, 0), true);
        bytes = File.ReadAllBytes(newer);
        check(InstallerDependencies.AdaptUltraLibrary(newer, android) && bytes.SequenceEqual(File.ReadAllBytes(newer)), "never downgrade future Ultra library");
        check(Directory.GetFiles(folder, "*.tmp").Length == 0, "no temporary files remain");
        foreach (var (label, flag) in new[] { ("mixed", CorFlags.ILOnly), ("native", CorFlags.NativeEntryPoint), ("signed", CorFlags.StrongNameSigned) }) {
            var path = Fixture(label, new Version(25, 3, 1, 0), true);
            bytes = File.ReadAllBytes(path);
            int offset;
            using (var pe = new PEReader(new MemoryStream(bytes))) offset = pe.PEHeaders.CorHeaderStartOffset + 16;
            var flags = BitConverter.ToInt32(bytes, offset);
            BitConverter.GetBytes(flag == CorFlags.ILOnly ? flags & ~(int)flag : flags | (int)flag).CopyTo(bytes, offset);
            File.WriteAllBytes(path, bytes);
            try { InstallerDependencies.AdaptUltraLibrary(path, android); throw new Exception("Unsafe library accepted"); }
            catch (BadImageFormatException) { check(bytes.SequenceEqual(File.ReadAllBytes(path)), label + " library remains unchanged"); }
        }

        var original = new StringWriter();
        var log = new StringWriter();
        using var writer = new InstallerLog(original, log);
        writer.Write('测'); writer.Write("试"); writer.WriteLine("安装"); writer.Flush();
        check(original.ToString() == log.ToString() && log.ToString().Contains("测试安装"), "UTF-8 log tee preserves console output");
    }
}
