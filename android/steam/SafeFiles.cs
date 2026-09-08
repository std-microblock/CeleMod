using System.Security.Cryptography;

namespace CeleMod.Steam;

internal static class SafeFiles
{
    internal static string Under(string root, string name)
    {
        name = name.Replace('\\', '/');
        if (string.IsNullOrWhiteSpace(name) || name.Contains(':') || name.Contains('\0') ||
            name.Split('/').Any(p => p is ".." or "." or "") || Path.IsPathRooted(name))
            throw new InvalidDataException("不安全的 Steam 文件路径。");
        root = Path.GetFullPath(root);
        if (Directory.Exists(root) && File.GetAttributes(root).HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidDataException("不允许使用符号链接作为文件根目录。");
        var path = Path.GetFullPath(Path.Combine(root, name));
        if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal)) throw new InvalidDataException("文件路径越界。");
        for (var current = path; current != root; current = Path.GetDirectoryName(current)!)
            if ((File.Exists(current) || Directory.Exists(current)) && File.GetAttributes(current).HasFlag(FileAttributes.ReparsePoint))
                throw new InvalidDataException("不允许符号链接或重解析点。");
        return path;
    }
    internal static string Hash(string path) { using var file = File.OpenRead(path); return Convert.ToHexString(SHA1.HashData(file)); }
    internal static void Verify(string path, byte[] hash, long size)
    {
        if (new FileInfo(path).Length != size || !Hash(path).Equals(Convert.ToHexString(hash), StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Steam 文件校验失败，原文件未覆盖，请重试。");
    }
    internal static void Replace(string source, string destination) {
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        File.Move(source, destination, true);
    }
}
