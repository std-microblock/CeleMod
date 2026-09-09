using System.Reflection;

static class RumbleTests
{
    private enum Player { One, Two, Three, Four }

    public static void Run()
    {
        int checks = 0;
        void Check(bool value, string name) {
            if (!value) throw new Exception(name);
            checks++;
        }
        Check(RumbleOutput.Amplitude(0, 0) == 0, "silence stays silent");
        Check(RumbleOutput.Amplitude(.4f, .15f) == 102, "stronger motor drives phone");
        Check(RumbleOutput.Amplitude(.15f, .4f) == 102, "right motor also drives phone");
        Check(RumbleOutput.Amplitude(.5f, .5f) == 128, "preserve reduced game strength");
        Check(RumbleOutput.Amplitude(2, -2) == 255, "clamp mod motor values");
        Check(RumbleOutput.Amplitude(float.NaN, float.PositiveInfinity) == 0, "reject nonfinite values");
        Check(RumbleOutput.Amplitude(float.NaN, .4f) == 102, "bad motor does not suppress valid motor");
        Check(RumbleOutput.Amplitude(.0001f, 0) == 1, "positive output never maps to invalid amplitude zero");

        var sent = new List<int>();
        var output = new RumbleOutput(sent.Add);
        output.Pump(0);
        output.Set(0, 0, 0, 1);
        Check(sent.Count == 0, "idle frames do not send cancellation or poll Android");
        output.Set(0, .4f, .4f, 2);
        Check(sent.SequenceEqual(new[] { 102 }), "send first output immediately");
        output.Set(1, 0, 0, 3);
        output.Set(0, .4f, .4f, 4);
        output.Pump(101);
        Check(sent.Count == 1, "idle pads and identical frames do not spam the motor");
        output.Pump(102);
        Check(sent.SequenceEqual(new[] { 102, 102 }), "refresh active lease after 100 ms");
        output.Set(1, 1, 1, 110);
        Check(sent[^1] == 255, "stronger second pad wins");
        output.Set(0, 0, 0, 111);
        Check(sent.Count == 3, "stopping one pad cannot stop another");
        output.Set(1, 0, 0, 112);
        Check(sent[^1] == 0 && sent.Count == 4, "stop immediately when all motors stop");
        output.Pump(10000);
        output.Set(-1, 1, 1, 10001);
        output.Set(4, 1, 1, 10002);
        Check(sent.Count == 4, "idle and invalid player indices remain silent");
        int attempts = 0;
        var failing = new RumbleOutput(_ => { attempts++; throw new DllNotFoundException("test"); });
        failing.Set(0, 1, 1, 0);
        failing.Pump(100);
        failing.Set(0, 0, 0, 200);
        Check(attempts == 1, "native failure is contained and logged only once");

        const BindingFlags flags = BindingFlags.NonPublic | BindingFlags.Static;
        var state = typeof(GameRumble).GetField("output", flags)!;
        var previous = state.GetValue(null);
        try {
            sent.Clear();
            state.SetValue(null, new RumbleOutput(sent.Add));
            var vibration = typeof(GameRumble).GetMethod("SetVibration", flags)!.MakeGenericMethod(typeof(Player))
                .CreateDelegate<Func<Func<Player, float, float, bool>, Player, float, float, bool>>();
            int originals = 0;
            bool result = vibration((player, left, right) => {
                originals++;
                Check(player == Player.One && left == .4f && right == .15f, "original motor arguments unchanged");
                return false;
            }, Player.One, .4f, .15f);
            Check(!result && originals == 1 && sent.SequenceEqual(new[] { 102 }),
                "no physical controller still vibrates phone without changing FNA result");
            Check(vibration((_, _, _) => true, Player.One, 0, 0) && sent[^1] == 0,
                "physical controller success and explicit stop preserved");
            int count = sent.Count;
            try {
                vibration((_, _, _) => throw new InvalidOperationException("original"), Player.One, 1, 1);
                throw new Exception("original exception swallowed");
            } catch (InvalidOperationException e) {
                Check(e.Message == "original" && sent.Count == count, "do not swallow game exceptions or publish failed calls");
            }
            var update = typeof(GameRumble).GetMethod("Update", flags)!.MakeGenericMethod(typeof(object), typeof(int))
                .CreateDelegate<Action<Action<object, int>, object, int>>();
            var game = new object();
            int updates = 0;
            update((instance, time) => {
                updates++;
                Check(ReferenceEquals(instance, game) && time == 42, "update trampoline preserves game arguments");
            }, game, 42);
            Check(updates == 1 && sent.Count == count, "update runs once and idle pump stays silent");
        } finally { state.SetValue(null, previous); }

        var enabled = Environment.GetEnvironmentVariable("CELEMOD_GAME_RUMBLE");
        try {
            Environment.SetEnvironmentVariable("CELEMOD_GAME_RUMBLE", null);
            GameRumble.Install(); // No FNA, game binary or native runtime needed while disabled.
            Check(ReferenceEquals(state.GetValue(null), previous), "default off does not load or install hooks");
        } finally { Environment.SetEnvironmentVariable("CELEMOD_GAME_RUMBLE", enabled); }
        Check(GameRumble.Command == 0xCE01, "SDL command matches Android receiver contract");
        Console.WriteLine($"PASS: {checks} game rumble output cases.");
    }
}
