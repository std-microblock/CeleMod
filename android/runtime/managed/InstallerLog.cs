using System.Text;

// The Android host routes Console to logcat, bypassing dup2(stdout). Tee it to
// our UTF-8 log as well, including output from MiniInstaller's own LogWriter.
internal sealed class InstallerLog(TextWriter original, TextWriter log) : TextWriter
{
    public override Encoding Encoding => Encoding.UTF8;
    public override void Write(char value) { original.Write(value); log.Write(value); }
    public override void Write(string? value) { original.Write(value); log.Write(value); }
    public override void WriteLine(string? value) { original.WriteLine(value); log.WriteLine(value); }
    public override void Flush() { original.Flush(); log.Flush(); }

    internal static void Install()
    {
        var path = Environment.GetEnvironmentVariable("CELEMOD_INSTALLER_LOG");
        if (string.IsNullOrEmpty(path)) return;
        var file = TextWriter.Synchronized(new StreamWriter(new FileStream(path,
            FileMode.Append, FileAccess.Write, FileShare.ReadWrite), new UTF8Encoding(false)) { AutoFlush = true });
        Console.SetOut(new InstallerLog(Console.Out, file));
        Console.SetError(new InstallerLog(Console.Error, file));
        AppDomain.CurrentDomain.UnhandledException += (_, e) => {
            file.WriteLine(e.ExceptionObject);
            file.Flush();
        };
        Console.WriteLine("[CeleMod] Preparing Android installer dependencies.");
    }
}
