using System.Reflection;
using System.Text.Json;

static class ModButtonTests
{
    private class SettingsBase { public Dictionary<string, object> Nested = new(); }
    private sealed class Settings : SettingsBase { public List<object> Items = new(); }
    private sealed class Button { public bool AutoConsumeBuffer; }
    private static class Engine { public static object? Scene; }
    private static class MInput {
        private static bool disabled;
        internal static int Reads;
        public static bool Disabled { get { Reads++; return disabled; } set => disabled = value; }
    }

    internal static void Run()
    {
        int count = 0;
        void Check(bool condition, string name) { if (!condition) throw new Exception(name); count++; }
        var a = new Button(); var b = new Button();
        var settings = new Settings { Items = { a }, Nested = { ["a/b~c"] = b } };
        Check(ReferenceEquals(GameModButtons.ResolvePath(settings, "/Items/0"), a), "nested list path");
        Check(ReferenceEquals(GameModButtons.ResolvePath(settings, "/Nested/a~1b~0c"), b), "inherited dictionary and escaped path");
        Check(GameModButtons.ResolvePath(settings, "/Items/-1") == null, "invalid list index");
        Check(GameModButtons.ResolvePath(settings, "/Gone") == null, "removed member");
        Check(GameModButtons.ResolvePath(settings, "Items/0") == null, "requires pointer");
        const string json = "[{\"id\":\"test-1\",\"label\":\"聊天\",\"enabled\":true,\"actions\":[{\"source\":\"MiaoNet\",\"actionPath\":\"/ChatButton\",\"format\":\"standard\"}]}]";
        var definitions = JsonSerializer.Deserialize<GameModButtons.Definition[]>(json)!;
        Check(GameModButtons.Valid(definitions), "manager JSON contract");
        Check(definitions[0].icon == "NONE", "old definitions default to text");
        Check(GameModButtons.Valid([definitions[0] with { icon = "CHAT" }]), "icon definitions accepted");
        Check(!GameModButtons.Valid([definitions[0] with { icon = "UNKNOWN" }]), "unknown icon rejected");
        Check(!GameModButtons.Valid([definitions[0], definitions[0]]), "duplicate IDs rejected");
        Check(!GameModButtons.Valid([definitions[0] with { actions = [] }]), "empty action list rejected");
        Check(!GameModButtons.Valid([definitions[0] with { id = "../bad" }]), "unsafe IDs rejected");
        Check(!GameModButtons.Valid([definitions[0] with { label = "\n" }]), "invisible labels rejected");

        var state = new ModButtonState();
        var targets = new Dictionary<string, object[]> { ["one"] = [a], ["combo"] = [a, b] };
        state.Apply(["one", "combo"], targets, 1000);
        Check(state.Held.SetEquals([a, b]) && state.Pressed.SetEquals([a, b]), "combo holds/presses only selected actions");
        state.BeginFrame();
        Check(state.Pressed.Count == 0 && state.Held.Count == 2, "hold doesn't repeat press");
        state.Apply(["combo"], targets, 1100);
        Check(state.Released.Count == 0 && state.Pressed.Count == 0, "shared owner release cannot drop action");
        state.Apply(["one"], targets, 1200);
        Check(state.Held.SetEquals([a]) && state.Released.SetEquals([b]), "only unowned action releases");
        state.BeginFrame(); state.Apply([], targets, 1300);
        Check(state.Held.Count == 0 && state.Released.SetEquals([a]), "last owner releases");
        state.BeginFrame(); state.Apply(["one"], targets, 1400);
        Check(state.Pressed.SetEquals([a]), "fast tap down retained for one frame");
        state.BeginFrame(); state.Apply([], targets, 1401);
        Check(state.Released.SetEquals([a]), "fast tap up retained for following frame");
        state.BeginFrame(); state.Apply(["gone"], targets, 1500);
        Check(state.Held.Count == 0, "missing Mod ignored");
        state.Apply(["one"], targets, 1600); state.Expire(2600);
        Check(state.Held.Count == 1, "valid heartbeat lease");
        state.Expire(2601);
        Check(state.Held.Count == 0 && state.Pressed.Count == 0, "stale input clears silently");
        state.Apply(["combo"], targets, 2700); state.Clear();
        Check(state.Held.Count + state.Pressed.Count + state.Released.Count == 0, "lifecycle clear drops every state");

        const BindingFlags flags = BindingFlags.Static | BindingFlags.NonPublic;
        var fields = new[] { "engine", "minput", "scene", "ui", "mode", "installed" }.Select(n => typeof(GameModButtons).GetField(n, flags)!).ToArray();
        var saved = fields.Select(f => f.GetValue(null)).ToArray();
        var live = (ModButtonState)typeof(GameModButtons).GetField("state", flags)!.GetValue(null)!;
        var scene = new Celeste.Level();
        try {
            Engine.Scene = scene;
            object?[] values = [typeof(Engine), typeof(MInput), scene, null, "gameplay", true];
            for (int i = 0; i < fields.Length; i++) fields[i].SetValue(null, values[i]);
            var check = typeof(GameModButtons).GetMethod("Check", flags)!.MakeGenericMethod(typeof(Button)).CreateDelegate<Func<Func<Button, bool>, Button, bool>>();
            var press = typeof(GameModButtons).GetMethod("Pressed", flags)!.MakeGenericMethod(typeof(Button)).CreateDelegate<Func<Func<Button, bool>, Button, bool>>();
            var release = typeof(GameModButtons).GetMethod("Released", flags)!.MakeGenericMethod(typeof(Button)).CreateDelegate<Func<Func<Button, bool>, Button, bool>>();
            var consume = typeof(GameModButtons).GetMethod("Consume", flags)!.MakeGenericMethod(typeof(Button)).CreateDelegate<Action<Action<Button>, Button>>();
            int originals = 0;
            bool Original(Button _) { originals++; return false; }
            live.Clear();
            MInput.Reads = 0;
            Check(!check(Original, a) && !press(Original, a) && !release(Original, a), "empty virtual state preserves original input");
            Check(MInput.Reads == 0, "unrelated/idle input bypasses all reflective context checks");
            originals = 0;
            live.Apply(["combo"], targets, 3000);
            Check(check(Original, a) && originals == 1, "Check joins original chain exactly once");
            Check(press(Original, a) && originals == 2, "Pressed joins original chain exactly once");
            consume(_ => originals++, a);
            Check(!press(Original, a) && check(Original, a), "consume press keeps held action");
            Check(press(_ => true, a), "physical input preserved");
            b.AutoConsumeBuffer = true;
            Check(press(Original, b) && !press(Original, b), "AutoConsumeBuffer respected");
            MInput.Disabled = true;
            Check(!check(Original, a), "disabled input suppresses virtual hold");
            MInput.Disabled = false;
            scene.Paused = true;
            Check(!check(Original, a), "pause cannot carry hold into menu");
            scene.Paused = false;
            Engine.Scene = new Celeste.Level();
            Check(!check(Original, a), "scene replacement blocks stale holds");
            Engine.Scene = scene;
            live.BeginFrame(); live.Apply([], targets, 3100);
            Check(release(Original, a), "Released trampoline");
        } finally {
            for (int i = 0; i < fields.Length; i++) fields[i].SetValue(null, saved[i]);
            live.Clear(); Engine.Scene = null; MInput.Disabled = false;
        }
        Console.WriteLine($"PASS: {count} custom Mod virtual-button cases.");
    }
}
