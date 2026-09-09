using System.Reflection;

// Exercise the exact typed trampoline signatures handed to MonoMod, without
// requiring the Android-only runtime or proprietary game assemblies on the host.
static class GameHookTests
{
    private const BindingFlags Flags = BindingFlags.Static | BindingFlags.NonPublic;
    private sealed class Button { }
    private sealed class Game { }
    private sealed class UI { public object? Current; }
    private static class Engine { public static object? Scene; }

    public static void Run()
    {
        int checks = 0;
        void Check(bool value, string name) {
            if (!value) throw new Exception(name);
            checks++;
        }
        var state = new[] { "engineType", "pressedScene", "pressedUI" }
            .Select(name => typeof(GameTouch).GetField(name, Flags)!).ToArray();
        var oldState = state.Select(field => field.GetValue(null)).ToArray();
        var presses = (HashSet<object>)typeof(GameTouch).GetField("pressed", Flags)!.GetValue(null)!;
        var oldPresses = presses.ToArray();
        var nextSample = typeof(GameControls).GetField("nextSample", Flags)!;
        var oldNextSample = nextSample.GetValue(null);
        var observed = typeof(GameControls).GetField("updateObserved", Flags)!;
        var oldObserved = observed.GetValue(null);
        try {
            presses.Clear();
            var button = new Button();
            var ui = new UI { Current = new object() };
            Engine.Scene = ui;
            state[0].SetValue(null, typeof(Engine));
            state[1].SetValue(null, ui);
            state[2].SetValue(null, ui.Current);
            var getPressed = typeof(GameTouch).GetMethod("ButtonPressed", Flags)!
                .MakeGenericMethod(typeof(Button))
                .CreateDelegate<Func<Func<Button, bool>, Button, bool>>();
            int originals = 0;
            Func<Button, bool> original = value => { originals++; return false; };
            Check(!getPressed(original, button) && originals == 1, "unpressed result and original preserved");
            presses.Add(button);
            Check(getPressed(original, button) && originals == 2, "semantic press composes with original exactly once");
            ui.Current = new object();
            Check(!getPressed(original, button), "UI change rejects old semantic press");
            Check(getPressed(_ => true, button), "real keyboard/controller press survives a UI change");
            state[2].SetValue(null, ui.Current);
            Engine.Scene = new UI();
            Check(!getPressed(original, button), "scene change rejects old semantic press");

            var consume = typeof(GameTouch).GetMethod("Consumed", Flags)!.MakeGenericMethod(typeof(Button))
                .CreateDelegate<Action<Action<Button>, Button>>();
            int consumed = 0;
            consume(value => { Check(ReferenceEquals(value, button) && presses.Contains(value),
                "game consumes its buffer before clearing synthetic state"); consumed++; }, button);
            Check(consumed == 1 && !presses.Contains(button), "consumption runs once and releases semantic press");

            var update = typeof(GameControls).GetMethod("Update", Flags)!
                .MakeGenericMethod(typeof(Game), typeof(int))
                .CreateDelegate<Action<Action<Game, int>, Game, int>>();
            nextSample.SetValue(null, long.MaxValue); // No snapshot IO in the trampoline test.
            var game = new Game();
            int updates = 0;
            update((self, time) => {
                Check(ReferenceEquals(self, game) && time == 42, "update forwards self and game time unchanged");
                updates++;
                presses.Add(button);
            }, game, 42);
            Check(updates == 1 && presses.Count == 0, "pump runs after the original update exactly once");
            var expected = new InvalidOperationException("game update failed");
            presses.Add(button);
            try { update((_, _) => throw expected, game, 42); throw new Exception("game exception swallowed"); }
            catch (InvalidOperationException error) {
                Check(ReferenceEquals(error, expected) && presses.Contains(button),
                    "original game exceptions propagate without running the post-update pump");
            }
        } finally {
            for (int i = 0; i < state.Length; i++) state[i].SetValue(null, oldState[i]);
            presses.Clear(); presses.UnionWith(oldPresses);
            nextSample.SetValue(null, oldNextSample);
            observed.SetValue(null, oldObserved);
            Engine.Scene = null;
        }
        Console.WriteLine($"PASS: {checks} managed detour trampoline cases.");
    }
}
