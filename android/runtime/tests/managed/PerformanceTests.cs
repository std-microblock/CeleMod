using System.Diagnostics;
using System.Reflection;

static class PerformanceTests
{
    // Hiding the inherited fields makes accidental reflection observable.
    private sealed class Decoration : Monocle.Entity {
        internal static int Reads;
        public new bool Visible { get { Reads++; return true; } }
        public new bool Active { get { Reads++; return true; } }
    }

    internal static void Run()
    {
        int checks = 0;
        void Check(bool value, string name) { if (!value) throw new Exception(name); checks++; }
        var level = new Celeste.Level();
        for (int i = 0; i < 4096; i++) level.Entities.Add(new Decoration());
        Decoration.Reads = 0;
        Check(GameControls.Classify(level) == "gameplay", "large decoration-only lobby remains playable");
        Check(Decoration.Reads == 0, "non-UI entities never incur reflective visibility/active reads");
        level.Entities.Add(new Celeste.Textbox { Opened = true });
        Check(GameControls.Classify(level) == "dialogue", "dialogue after thousands of decorations remains detected");
        level.Entities.Add(new Celeste.TextMenu { Focused = true });
        Check(GameControls.Classify(level) == "menu", "focused menu still takes precedence over dialogue");
        Check(Decoration.Reads == 0, "UI detection does not inspect decoration state");
        Check(GameControls.Is(level, "Monocle.Scene") && !GameControls.Is(level, "Celeste.TextMenu"),
            "positive and negative cached inheritance matches remain independent");

        var timing = new FrameTiming();
        Check(timing.Count == 0 && timing.AverageMs == 0 && timing.MaxMs == 0, "empty frame window has no NaN values");
        timing.Add(Stopwatch.Frequency / 100); // 10 ms.
        timing.Add(Stopwatch.Frequency / 20);  // 50 ms.
        Check(timing.Count == 2 && Math.Abs(timing.AverageMs - 30) < 0.01 && Math.Abs(timing.MaxMs - 50) < 0.01,
            "frame timings use the platform stopwatch frequency");
        Check(timing.SlowFrames == 1, "count frames slower than 30 FPS separately");
        timing.Clear();
        Check(timing.Count == 0 && timing.SlowFrames == 0 && timing.MaxMs == 0, "new map/window discards previous timings");
        timing.Add(-1);
        Check(timing.AverageMs == 0, "negative timing input never yields negative metrics");
        long bytes = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 10000; i++) timing.Add(100);
        Check(GC.GetAllocatedBytesForCurrentThread() == bytes, "per-frame accumulator creates no garbage");
        Check(!GamePerformance.Enabled, "profiling is opt-in, not enabled by normal startup");
        foreach (var name in new[] { "Update", "Draw" }) {
            var hook = typeof(GamePerformance).GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static)!
                .MakeGenericMethod(typeof(object), typeof(int)).CreateDelegate<Action<Action<object, int>, object, int>>();
            var self = new object(); int calls = 0;
            hook((game, time) => { calls++; Check(ReferenceEquals(game, self) && time == 42, "profiler forwards update/draw arguments"); }, self, 42);
            Check(calls == 1, "profiler runs original once");
            var expected = new InvalidOperationException("game failed");
            try { hook((_, _) => throw expected, self, 42); throw new Exception("game exception swallowed"); }
            catch (InvalidOperationException e) { Check(ReferenceEquals(e, expected), "profiling preserves original exception"); }
        }
        Console.WriteLine($"PASS: {checks} large-Mod performance regression cases.");
    }

    // Reproducible bridge microbenchmark, not an FPS or whole-game memory claim.
    internal static void Benchmark()
    {
        var level = new Celeste.Level();
        for (int i = 0; i < 4096; i++) level.Entities.Add(new Decoration());
        for (int i = 0; i < 50; i++) GameControls.Classify(level);
        Decoration.Reads = 0;
        var watch = new Stopwatch();
        long bytes = GC.GetAllocatedBytesForCurrentThread();
        watch.Start();
        for (int i = 0; i < 1000; i++) GameControls.Classify(level);
        watch.Stop();
        bytes = GC.GetAllocatedBytesForCurrentThread() - bytes;
        Console.WriteLine($"LOBBY BENCHMARK: 4096 entities x 1000 scans: {watch.Elapsed.TotalMilliseconds:F2} ms, {bytes} bytes, {Decoration.Reads} property reads.");
    }
}
