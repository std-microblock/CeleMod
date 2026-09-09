using System.Text;

// The host sends managed Console output directly to logcat, bypassing dup2.
// Retain the original error in the app's game log even if the console or file
// sink fails while Everest is already handling an exception.
internal sealed class GameLog(TextWriter original, TextWriter log) : TextWriter
{
    public override Encoding Encoding => Encoding.UTF8;

    private static void TryWrite(Action write)
    {
        try { write(); }
        catch (Exception) { /* Diagnostics must never replace the game exception. */ }
    }

    public override void Write(char value)
    {
        TryWrite(() => log.Write(value));
        TryWrite(() => original.Write(value));
    }

    public override void Write(string? value)
    {
        TryWrite(() => log.Write(value));
        TryWrite(() => original.Write(value));
    }

    public override void WriteLine(string? value)
    {
        TryWrite(() => log.WriteLine(value));
        TryWrite(() => original.WriteLine(value));
    }

    public override void Flush()
    {
        TryWrite(log.Flush);
        TryWrite(original.Flush);
    }

    private static bool installed;
    internal static void Install()
    {
        if (installed) return;
        var path = Environment.GetEnvironmentVariable("CELEMOD_GAME_LOG");
        if (string.IsNullOrEmpty(path)) return;
        try {
            // RuntimeHost truncates once per launch; do not erase earlier native output.
            var file = TextWriter.Synchronized(new StreamWriter(AppendLogStream.Open(path),
                new UTF8Encoding(false)) { AutoFlush = true });
            Console.SetOut(new GameLog(Console.Out, file));
            Console.SetError(new GameLog(Console.Error, file));
            AppDomain.CurrentDomain.UnhandledException += (_, e) =>
                TryWrite(() => { file.WriteLine(e.ExceptionObject); file.Flush(); });
            installed = true;
        } catch (Exception e) {
            TryWrite(() => Console.Error.WriteLine("[CeleMod] Game log capture unavailable: " + e));
        }
    }
}
