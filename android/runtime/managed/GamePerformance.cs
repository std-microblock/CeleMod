using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Runtime.Loader;

// Opt-in map-time diagnostics. No forced GC, per-frame IO, texture eviction,
// render-setting changes, or references to entities retained in queued reports.
internal static class GamePerformance
{
    internal static bool Enabled { get; private set; }
    private static Type? engine;
    private static object? scene;
    private static readonly FrameTiming updates = new(), draws = new(), bridge = new(), intervals = new();
    private static long started, lastDraw, allocated;
    private static int gen0, gen1, gen2, writing;

    internal static void Install()
    {
        if (!File.Exists(Path.Combine(AppContext.BaseDirectory, "celemod-performance.flag"))) return;
        try {
            var file = Path.Combine(AppContext.BaseDirectory, "Celeste.dll");
            if (!File.Exists(file)) file = Path.Combine(AppContext.BaseDirectory, "Celeste.exe");
            engine = AssemblyLoadContext.Default.LoadFromAssemblyPath(file).GetType("Monocle.Engine", true)!;
            const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly;
            foreach (var name in new[] { "Update", "Draw" }) {
                var method = engine.GetMethods(flags).Single(m => m.Name == name && m.GetParameters().Length == 1);
                GameHooks.Add(method, name, typeof(GamePerformance), engine, method.GetParameters()[0].ParameterType);
            }
            Enabled = true;
            Console.WriteLine("[CeleMod perf] Map-time profiling enabled (10-second windows; CPU Draw is not a GPU timer).");
        } catch (Exception e) {
            Console.WriteLine("[CeleMod perf] Profiling unavailable: " + e.Message);
        }
    }

    internal static long Timestamp() => Enabled ? Stopwatch.GetTimestamp() : 0;
    internal static void BridgeCompleted(long began) {
        if (Enabled) bridge.Add(Stopwatch.GetTimestamp() - began);
    }

    private static void Update<TGame, TTime>(Action<TGame, TTime> original, TGame game, TTime time)
    {
        if (!Enabled) { original(game, time); return; }
        long began = Stopwatch.GetTimestamp();
        original(game, time); // Never catch or replace game exceptions.
        long now = Stopwatch.GetTimestamp();
        try {
            var current = GameControls.Read(engine, "Scene");
            // Do not mislabel a loader/scene-transition update as map gameplay.
            if (!ReferenceEquals(current, scene)) { scene = current; Reset(now); return; }
            if (!GameControls.Is(scene, "Celeste.Level")) return;
            if (GameControls.Read(scene, "Paused") is true) { Reset(now); return; }
            updates.Add(now - began);
            if (now - started >= Stopwatch.Frequency * 10) { Report(now); Reset(now); }
        } catch { Enabled = false; scene = null; } // Do not retain a level if diagnostics fail.
    }

    private static void Draw<TGame, TTime>(Action<TGame, TTime> original, TGame game, TTime time)
    {
        if (!Enabled) { original(game, time); return; }
        long began = Stopwatch.GetTimestamp();
        original(game, time);
        draws.Add(Stopwatch.GetTimestamp() - began);
        if (lastDraw != 0) intervals.Add(began - lastDraw);
        lastDraw = began;
    }

    private static void Reset(long now)
    {
        started = now; lastDraw = 0;
        updates.Clear(); draws.Clear(); bridge.Clear(); intervals.Clear();
        allocated = GC.GetTotalAllocatedBytes(false);
        gen0 = GC.CollectionCount(0); gen1 = GC.CollectionCount(1); gen2 = GC.CollectionCount(2);
    }

    private static void Report(long now)
    {
        double seconds = (now - started) / (double)Stopwatch.Frequency;
        var session = GameControls.Read(scene, "Session");
        var area = GameControls.Read(session, "Area");
        var entities = GameControls.Read(GameControls.Read(scene, "Entities"), "Count");
        // Format and detach on the game thread: the writer never touches game objects.
        var message = string.Create(CultureInfo.InvariantCulture,
            $"[CeleMod perf] area={GameControls.Read(area, "ID")} room={GameControls.Read(session, "Level")} entities={entities} window={seconds:F1}s " +
            $"fps={draws.Count / seconds:F1} frame={intervals.AverageMs:F2}/{intervals.MaxMs:F2}ms slow33={intervals.SlowFrames} " +
            $"update={updates.AverageMs:F2}/{updates.MaxMs:F2}ms drawCpu={draws.AverageMs:F2}/{draws.MaxMs:F2}ms " +
            $"bridgePerUpdate={bridge.TotalMs / Math.Max(1, updates.Count):F3}ms " +
            $"alloc={(GC.GetTotalAllocatedBytes(false) - allocated) / seconds / 1048576:F2}MiB/s " +
            $"managed={GC.GetTotalMemory(false) / 1048576.0:F1}MiB gc={GC.CollectionCount(0) - gen0}/{GC.CollectionCount(1) - gen1}/{GC.CollectionCount(2) - gen2}");
        if (Interlocked.CompareExchange(ref writing, 1, 0) != 0) return;
        ThreadPool.QueueUserWorkItem(_ => {
            try {
                // RSS includes resident mapped/native memory, but is NOT Android
                // PSS or a GPU allocation total. Failure leaves the CPU/GC report.
                string rss = "";
                try { rss = File.ReadLines("/proc/self/status").FirstOrDefault(l => l.StartsWith("VmRSS:", StringComparison.Ordinal)) ?? ""; }
                catch (Exception) { }
                Console.WriteLine(message + (rss.Length == 0 ? "" : " " + rss.Trim()));
            } catch (Exception) { }
            finally { Interlocked.Exchange(ref writing, 0); }
        });
    }
}

// Fixed-size accumulators: zero allocation and no growing frame history.
internal sealed class FrameTiming
{
    internal long Count { get; private set; }
    private long total, max;
    internal long SlowFrames { get; private set; }
    internal double TotalMs => total * 1000.0 / Stopwatch.Frequency;
    internal double AverageMs => Count == 0 ? 0 : TotalMs / Count;
    internal double MaxMs => max * 1000.0 / Stopwatch.Frequency;
    internal void Add(long ticks) {
        ticks = Math.Max(0, ticks);
        Count++; total += ticks; max = Math.Max(max, ticks);
        if (ticks > Stopwatch.Frequency / 30.0) SlowFrames++;
    }
    internal void Clear() { Count = total = max = SlowFrames = 0; }
}
