using System.Reflection;

internal static class ConsoleColorTests
{
    internal static void Run(Action<bool, string> check)
    {
        var start = StartupHook.Patches.Count;
        var output = Console.Out;
        var error = Console.Error;
        ConsoleColors.Install();
        var patches = StartupHook.Patches.Skip(start).ToArray();
        check(patches.Length == 5, "install exactly the five color hooks");
        check(patches.Select(p => p.Method.Name).Order().SequenceEqual(new[] {
            "ResetColor", "get_BackgroundColor", "get_ForegroundColor", "set_BackgroundColor", "set_ForegroundColor"
        }.Order()), "target real Console color accessors and ResetColor only");
        check(patches.All(p => p.Method.DeclaringType == typeof(Console) && p.Owner == typeof(ConsoleColors)),
            "color hooks target the shared Console API, not individual mods");
        ConsoleColors.Install();
        check(StartupHook.Patches.Count == start + 5, "repeated installation does not duplicate hooks");
        check(ReferenceEquals(output, Console.Out) && ReferenceEquals(error, Console.Error),
            "color compatibility preserves log output writers");

        MethodInfo Hook(string target) {
            var patch = patches.Single(p => p.Method.Name == target);
            return patch.Owner.GetMethod(patch.Prefix, BindingFlags.Static | BindingFlags.NonPublic)!;
        }
        void Set(string property, ConsoleColor value) {
            var hook = Hook("set_" + property);
            check(hook.GetParameters()[0].Name == "__0", "setter binds color by argument position");
            check(hook.Invoke(null, new object[] { value }) is false, "setter skips unsupported terminal API");
        }
        ConsoleColor Get(string property) {
            var hook = Hook("get_" + property);
            var parameter = hook.GetParameters()[0];
            check(parameter.Name == "__result" && parameter.ParameterType == typeof(ConsoleColor).MakeByRefType(),
                "getter supplies Harmony result by reference");
            object[] args = [ConsoleColor.Magenta];
            check(hook.Invoke(null, args) is false, "getter skips unsupported terminal API");
            return (ConsoleColor)args[0];
        }
        void Reset() => check(Hook("ResetColor").Invoke(null, null) is false, "reset skips unsupported terminal API");

        Reset();
        check(Get("ForegroundColor") == ConsoleColor.Gray && Get("BackgroundColor") == ConsoleColor.Black,
            "default colors are gray on black");
        foreach (var property in new[] { "ForegroundColor", "BackgroundColor" }) {
            var other = property == "ForegroundColor" ? "BackgroundColor" : "ForegroundColor";
            var otherColor = Get(other);
            foreach (var color in Enum.GetValues<ConsoleColor>()) {
                Set(property, color);
                check(Get(property) == color, "all 16 colors round-trip: " + property);
                check(Get(other) == otherColor, "foreground and background remain independent");
            }
            var before = Get(property);
            foreach (var invalid in new[] { -1, 16, int.MinValue, int.MaxValue }) {
                try {
                    Hook("set_" + property).Invoke(null, new object[] { (ConsoleColor)invalid });
                    throw new Exception("Invalid console color accepted");
                } catch (TargetInvocationException ex) when (ex.InnerException is ArgumentOutOfRangeException arg) {
                    check(arg.ParamName == "value", "invalid colors retain Console argument validation");
                    check(Get(property) == before, "invalid colors do not modify prior state");
                }
            }
        }
        // ChroniaHelper-style colored logging: preserve the caller's color.
        var saved = Get("ForegroundColor");
        Set("ForegroundColor", ConsoleColor.Cyan);
        Set("ForegroundColor", saved);
        check(Get("ForegroundColor") == saved, "save/set/restore logging pattern is supported");
        Reset();
        check(Get("ForegroundColor") == ConsoleColor.Gray && Get("BackgroundColor") == ConsoleColor.Black,
            "reset restores both defaults after logging");
    }
}
