using System.IO.Compression;
using System.Security.Cryptography;
using CeleMod.Steam;

var count = 0;
void Check(bool value, string message) { count++; if (!value) throw new Exception(message); }
void Reject(Action action, string message) {
    try { action(); } catch (InvalidDataException) { count++; return; }
    throw new Exception(message);
}
var cases = new (string? b, string? l, string? r, SyncAction a)[] {
    (null, null, null, SyncAction.None), (null, "a", null, SyncAction.Push), (null, null, "a", SyncAction.Pull),
    (null, "a", "a", SyncAction.None), (null, "a", "b", SyncAction.Conflict),
    ("a", "a", "a", SyncAction.None), ("a", "b", "a", SyncAction.Push), ("a", "a", "b", SyncAction.Pull),
    ("a", "b", "c", SyncAction.Conflict), ("a", "b", "b", SyncAction.None),
    ("a", null, "a", SyncAction.Push), ("a", "a", null, SyncAction.Pull), ("a", null, null, SyncAction.None),
    ("a", null, "b", SyncAction.Conflict), ("a", "b", null, SyncAction.Conflict),
};
foreach (var (b, l, r, action) in cases) Check(SyncPlan.Decide(b, l, r) == action, $"3-way sync: {b}/{l}/{r}");
// Exhaustive safety properties, including old failed uploads (local == remote) and deleted save slots.
foreach (var b in new string?[] { null, "a", "b" })
foreach (var l in new string?[] { null, "a", "b" })
foreach (var r in new string?[] { null, "a", "b" }) {
    var action = SyncPlan.Decide(b, l, r);
    Check(action != SyncAction.Push || r == b, "Never overwrite independently changed cloud state");
    Check(action != SyncAction.Pull || l == b, "Never overwrite independently changed local state");
}
var before = new Dictionary<string, string> { ["Saves/0.celeste"] = "a" };
var local = new Dictionary<string, string> { ["Saves/0.celeste"] = "b", ["Saves/1.celeste"] = "c" };
var remote = new Dictionary<string, string> { ["Saves/0.celeste"] = "a", ["Saves/2.celeste"] = "d" };
var plan = SyncPlan.Build(before, local, remote);
Check(plan.Count == 3 && plan.Count(p => p.Action == SyncAction.Push) == 2 && plan.Count(p => p.Action == SyncAction.Pull) == 1, "Union independent changes");
Check(!SyncPlan.Same(local, remote) && SyncPlan.Same(local, new(local)), "Conflict snapshot freshness");
Check(SyncPlan.SaveName("Saves/0.celeste") == "0.celeste", "Save path");
Check(SyncPlan.SaveName("Saves\\modsave-0.celeste") == "modsave-0.celeste", "Windows cloud separator");
Check(SyncPlan.RemoteName(["Saves"], 0, "0.celeste") == "Saves/0.celeste", "Cloud prefix joining");
Check(SyncPlan.RemoteName(["Saves/"], 0, "0.celeste") == "Saves/0.celeste", "Trailing slash prefix");
Check(SyncPlan.RemoteName(["Saves"], uint.MaxValue, "Saves/0.celeste") == "Saves/0.celeste", "No-prefix sentinel");
var autoCloud = "%GameInstall%Saves/0-modsave-AchievementHelper.celeste";
Check(SyncPlan.SaveName(autoCloud) == "0-modsave-AchievementHelper.celeste", "Real Steam Auto-Cloud root token");
Check(SyncPlan.RemoteName(["%GameInstall%Saves/"], 0, "0-modsave-AchievementHelper.celeste") == autoCloud, "Preserve Auto-Cloud wire name");
Check(SyncPlan.RemoteName([], uint.MaxValue, autoCloud) == autoCloud, "Unprefixed Auto-Cloud wire name");
Check(SyncPlan.SaveKey("%GameInstall%/Saves/0.celeste") == "Saves/0.celeste", "Root separator canonicalization");
Check(SyncPlan.SaveKey("%GameInstall%Saves\\0.celeste") == "Saves/0.celeste", "Windows Auto-Cloud key");
Check(SyncPlan.UploadName("Saves/0.celeste") == "%GameInstall%Saves/0.celeste", "New saves use Steam Auto-Cloud namespace");
Check(SyncPlan.UploadName("Saves/0.celeste", "%GameInstall%Saves\\0.celeste") == "%GameInstall%Saves\\0.celeste", "Existing wire names are unchanged");
Check(SyncPlan.UploadName("Saves/0.celeste", "Saves/0.celeste") == "Saves/0.celeste", "Legacy wire names are unchanged");
Reject(() => SyncPlan.UploadName("Saves/0.celeste", "%GameInstall%Saves/1.celeste"), "Mismatched wire name");
var aliases = new Dictionary<string, string>(StringComparer.Ordinal) { [SyncPlan.SaveKey(autoCloud)] = autoCloud };
Check(!aliases.TryAdd(SyncPlan.SaveKey("Saves/0-modsave-AchievementHelper.celeste"), "alias"), "Duplicate aliases cannot overwrite the same local save");
foreach (var name in new[] { "%GameInstall%../Saves/0.celeste", "%GameInstall%Saves/../0.celeste", "%GameInstall%//Saves/0.celeste", "%GameInstall%Saves/a/0.celeste", "%WinAppData%Saves/0.celeste", "%gameinstall%Saves/0.celeste", "%GameInstall%Saves/a:0.celeste" })
    Reject(() => SyncPlan.SaveKey(name), "Unsafe Auto-Cloud mapping: " + name);
foreach (var name in new[] { "0.celeste", "../Saves/0.celeste", "Saves/../0.celeste", "Saves/a/0.celeste", "Saves/a:0.celeste", "Saves/.celeste", "Saves/0.celeste\0", "/Saves/0.celeste", "Mods/x.zip", "Saves/settings.xml" })
    Reject(() => SyncPlan.SaveName(name), "Unsafe cloud mapping: " + name);
var root = Path.Combine(Path.GetTempPath(), "celemod-steam-test-" + Guid.NewGuid().ToString("N"));
foreach (var host in new[] { "steamcloudlrstyo.blob.core.windows.net", "steamcloudlrstyo.blob.core.windows.net:443", "steamcloud-hk.storage.googleapis.com", "steamcloud-hkg.oss-accelerate.aliyuncs.com", "steamcloud-hkg.oss-cn-hongkong.aliyuncs.com", "cdn.steamusercontent.com", "bucket.s3.amazonaws.com" })
    Check(CloudAddress.Url(host, "/save?signature=private").Scheme == "https", "Authenticated Steam storage host: " + host);
foreach (var host in new[] { "evil.blob.core.windows.net", "evil.storage.googleapis.com", "evil.oss-accelerate.aliyuncs.com", "steamcloud-hkg.oss-accelerate.aliyuncs.com.evil.com", "steamcloud-hk.storage.googleapis.com.evil.com", "steamcloud.blob.core.windows.net.evil.com", "steamcloudlrstyo.blob.core.windows.net:80", "127.0.0.1", "evil.com", "user@cdn.steamcontent.com", "cdn.steamcontent.com/hidden?query=" })
    Reject(() => CloudAddress.Url(host, "/save"), "Unsafe cloud address: " + host);
Reject(() => CloudAddress.Url("cdn.steamcontent.com", "bad-path"), "Non-absolute cloud path");
try { CloudAddress.Url("evil.com", "/save?signature=private"); }
catch (InvalidDataException e) { Check(!e.Message.Contains("signature") && !e.Message.Contains("private"), "Errors never expose signed cloud paths"); }
Directory.CreateDirectory(root);
try {
    foreach (var name in new[] { "../escape", "/absolute", "a/../../escape", "C:/escape", "a//b", "./a", "a/./b", "a\0" })
        Reject(() => SafeFiles.Under(root, name), "Unsafe depot path: " + name);
    Check(SafeFiles.Under(root, "Content\\a.data") == Path.Combine(root, "Content", "a.data"), "Safe depot normalization");
    var content = "<SaveData><Name>测试</Name></SaveData>"u8.ToArray();
    var file = Path.Combine(root, "save"); File.WriteAllBytes(file, content);
    SafeFiles.Verify(file, SHA1.HashData(content), content.Length); count++;
    Reject(() => SafeFiles.Verify(file, new byte[20], content.Length), "Hash mismatch accepted");
    Reject(() => SafeFiles.Verify(file, SHA1.HashData(content), content.Length + 1), "Size mismatch accepted");
    var zip = Path.Combine(root, "cloud.zip");
    using (var archive = ZipFile.Open(zip, ZipArchiveMode.Create)) using (var stream = archive.CreateEntry("../../ignored-name").Open()) stream.Write(content);
    CloudPayload.Unpack(zip, (uint)content.Length);
    Check(File.ReadAllBytes(zip).SequenceEqual(content), "PC ZIP payload bounded extraction");
    var bomb = Path.Combine(root, "bad.zip");
    using (var archive = ZipFile.Open(bomb, ZipArchiveMode.Create)) { archive.CreateEntry("a"); archive.CreateEntry("b"); }
    Reject(() => CloudPayload.Unpack(bomb, 0), "Multi-entry cloud ZIP accepted");
    Check(File.Exists(bomb) && !File.Exists(bomb + ".unpacked"), "Failed ZIP leaves original and no partial output");
} finally { Directory.Delete(root, true); }
count += await CloudTransferTests.Run();
Console.WriteLine($"PASS: {count} Steam cloud/depot safety assertions (no account or network required).");
