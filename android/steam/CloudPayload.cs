using System.IO.Compression;

namespace CeleMod.Steam;

internal static class CloudPayload
{
    // PC Steam can upload a single-file ZIP. Decompress to a bounded stream, ignoring the archive's filename.
    internal static void Unpack(string path, uint expectedSize)
    {
        var output = path + ".unpacked";
        try {
            using (var archive = ZipFile.OpenRead(path)) {
                if (archive.Entries.Count != 1 || archive.Entries[0].Length != expectedSize)
                    throw new InvalidDataException("Steam 云存档压缩包大小不匹配或包含多个文件。");
                using var source = archive.Entries[0].Open();
                using var target = File.Create(output);
                var buffer = new byte[65536]; long total = 0;
                while (true) {
                    var count = source.Read(buffer); if (count == 0) break;
                    total += count; if (total > expectedSize) throw new InvalidDataException("Steam 云存档解压越界。");
                    target.Write(buffer, 0, count);
                }
                if (total != expectedSize) throw new InvalidDataException("Steam 云存档压缩数据不完整。");
                target.Flush(true);
            }
            File.Move(output, path, true);
        } finally { if (File.Exists(output)) File.Delete(output); }
    }
}
