using System.Diagnostics;
using System.Reflection;
using System.Text;

internal static class GameLogTests
{
    internal static void Run(string root, Action<bool, string> check)
    {
        var original = new StringWriter();
        var log = new StringWriter();
        var tee = new GameLog(original, log);
        tee.Write('测'); tee.Write("试"); tee.WriteLine("日志");
        tee.Write(new[] { 'a', 'b', 'c' }, 1, 2);
        tee.WriteLine((string?)null);
        tee.WriteLine(new InvalidOperationException("original failure", new IOException("inner cause")));
        tee.Flush();
        check(tee.Encoding == Encoding.UTF8 && original.ToString() == log.ToString(), "game log tee preserves UTF-8 and console output");
        check(log.ToString().Contains("测试日志") && log.ToString().Contains("bc") &&
            log.ToString().Contains("original failure") && log.ToString().Contains("inner cause"),
            "game log retains original exception and its inner exception");

        foreach (var failedConsole in new[] { false, true }) {
            var surviving = new StringWriter();
            var failing = new FailingWriter();
            var writer = failedConsole ? new GameLog(failing, surviving) : new GameLog(surviving, failing);
            writer.Write('原'); writer.Write("始"); writer.WriteLine("错误"); writer.Flush();
            check(surviving.ToString().Contains("原始错误"), "one failed sink cannot hide the error from the other");
        }
        var bothFailed = new GameLog(new FailingWriter(), new FailingWriter());
        var expected = new InvalidOperationException("game exception must survive");
        try {
            try { throw expected; }
            finally { bothFailed.WriteLine("error reporting"); bothFailed.Flush(); }
        } catch (InvalidOperationException error) {
            check(ReferenceEquals(error, expected), "diagnostic IO never replaces the original game exception");
        }

        // A child process exercises the real Install path without leaving Console
        // wrappers, unhandled-exception handlers or open file handles in this runner.
        string Probe(string path) {
            var start = new ProcessStartInfo(Environment.ProcessPath!) {
                UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true
            };
            if (Path.GetFileNameWithoutExtension(start.FileName).Equals("dotnet", StringComparison.OrdinalIgnoreCase))
                start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
            start.ArgumentList.Add("--game-log-probe");
            start.Environment["CELEMOD_GAME_LOG"] = path;
            using var process = Process.Start(start)!;
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(30000)) { process.Kill(entireProcessTree: true); throw new Exception("Game log probe timed out"); }
            check(process.ExitCode == 0, "log capture does not break startup or exception reporting");
            return stdout.GetAwaiter().GetResult() + stderr.GetAwaiter().GetResult();
        }
        var path = Path.Combine(root, "game.log");
        File.WriteAllText(path, "native startup\n");
        var console = Probe(path);
        var captured = File.ReadAllText(path);
        check(captured.StartsWith("native startup\n"), "installation appends without erasing native startup diagnostics");
        check(captured.Split("managed stdout 原始错误").Length == 2, "repeated installation records output only once");
        check(captured.Contains("original game failure") && captured.Contains("inner cause") && captured.Contains(" at "),
            "installed stderr capture retains the original exception, inner cause and stack trace");
        check(console.Contains("managed stdout 原始错误") && console.Contains("original game failure"), "installed capture preserves both console streams");
        console = Probe(Path.Combine(root, "missing-parent", "game.log"));
        check(console.Contains("original game failure"), "unwritable game log leaves original console diagnostics available");

        if (OperatingSystem.IsLinux() || OperatingSystem.IsAndroid()) {
            var shared = Path.Combine(root, "interleaved.log");
            using (var first = AppendLogStream.Open(shared))
            using (var second = AppendLogStream.Open(shared)) {
                first.Write(Encoding.UTF8.GetBytes("first\n"));
                second.Write(Encoding.UTF8.GetBytes("second\n"));
                first.Write(Encoding.UTF8.GetBytes("!third\n!"), 1, 6);
            }
            check(File.ReadAllText(shared) == "first\nsecond\nthird\n", "kernel append preserves interleaved writes from separate descriptors");
        }
    }

    private sealed class FailingWriter : TextWriter
    {
        public override Encoding Encoding => Encoding.UTF8;
        public override void Write(char value) => throw new IOException("broken sink");
        public override void Write(string? value) => throw new IOException("broken sink");
        public override void WriteLine(string? value) => throw new IOException("broken sink");
        public override void Flush() => throw new IOException("broken sink");
    }
}
