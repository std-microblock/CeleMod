using System.Collections;
using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;

// Semantic virtual input: never rebind settings or inject another feature's key.
internal static class GameModButtons
{
    internal sealed record ActionRef(string source, string actionPath, string format);
    internal sealed record Definition(string id, string label, bool enabled, ActionRef[] actions, string icon = "NONE");
    internal sealed record View(string id, string label, int code, bool available, string icon);
    internal sealed record Command(long seq, long sentAt, string epoch, string[] held);
    private static Definition[] definitions = [];
    private static readonly ConcurrentQueue<Command> incoming = new();
    private static readonly ModButtonState state = new();
    private static readonly string session = Guid.NewGuid().ToString("N");
    private static Type? everest, engine, input, minput;
    private static object? scene, ui;
    private static string mode = "", epoch = "";
    private static long generation, sequence, refreshedAt;
    private static Dictionary<string, object[]> targets = new();
    private static bool installed;
    private static bool paused;
    private static object? R(object? target, string name) => GameControls.Read(target, name);

    internal static void Install(Assembly game, Type engineType, Type inputType, string path)
    {
        try {
            engine = engineType; input = inputType;
            everest = game.GetType("Celeste.Mod.Everest");
            minput = game.GetType("Monocle.MInput");
            var file = Path.Combine(AppContext.BaseDirectory, "celemod-touch-buttons.json");
            if (!File.Exists(file)) return;
            if (new FileInfo(file).Length > 262144) throw new InvalidDataException("Touch configuration too large.");
            definitions = JsonSerializer.Deserialize<Definition[]>(File.ReadAllText(file)) ?? [];
            if (!Valid(definitions)) throw new InvalidDataException("Invalid touch button configuration.");
            var button = game.GetType("Monocle.VirtualButton", true)!;
            foreach (var name in new[] { "Check", "Pressed", "Released" })
                GameHooks.Add(button.GetProperty(name)!.GetMethod!, name, typeof(GameModButtons), button);
            foreach (var name in new[] { "ConsumeBuffer", "ConsumePress" }) {
                var method = button.GetMethod(name);
                if (method != null) GameHooks.Add(method, nameof(Consume), typeof(GameModButtons), button);
            }
            installed = true;
            _ = Task.Run(async () => {
                while (true) {
                    try {
                        var info = new FileInfo(path + ".buttons");
                        if (info.Exists && info.Length <= 65536) {
                            var commands = JsonSerializer.Deserialize<Command[]>(await File.ReadAllTextAsync(info.FullName));
                            if (commands is { Length: <= 64 }) foreach (var command in commands) {
                                if (command == null || command.seq <= sequence) continue;
                                sequence = command.seq;
                                if (command.held is { Length: <= 24 } && command.epoch != null && incoming.Count < 128)
                                    incoming.Enqueue(command);
                            }
                        }
                    } catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException) { }
                    await Task.Delay(8);
                }
            });
            Console.WriteLine($"[CeleMod] {definitions.Length} custom virtual buttons connected to Mod actions.");
        } catch (Exception e) {
            definitions = []; installed = false;
            Console.WriteLine("[CeleMod] Custom virtual buttons unavailable: " + e);
        }
    }

    internal static bool Valid(Definition[] values) => values.Length <= 24 &&
        values.All(d => d != null && d.id is { Length: > 0 and <= 48 } &&
            d.id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_') &&
            !string.IsNullOrWhiteSpace(d.label) && d.label.EnumerateRunes().Count() <= 16 && !d.label.Any(char.IsControl) &&
            d.icon is "NONE" or "CHAT" or "BOLT" or "STAR" or "BOOK" or "KEYBOARD" or "PAUSE" or "PLAY" or "CONFIRM" or "BACK" &&
            d.actions is { Length: > 0 and <= 16 } && d.actions.All(a => a != null &&
                a.source is { Length: > 0 and <= 200 } && a.actionPath is { Length: > 0 and <= 512 } &&
                a.actionPath.StartsWith('/') && a.format is "standard" or "vanilla")) &&
        values.Select(d => d.id).Distinct().Count() == values.Length;

    // JSON pointer paths match the existing YAML catalog, including nested lists/maps.
    internal static object? ResolvePath(object? settings, string pointer)
    {
        if (!pointer.StartsWith('/')) return null;
        foreach (var token in pointer[1..].Split('/')) {
            var name = token.Replace("~1", "/").Replace("~0", "~");
            settings = settings switch {
                IDictionary map => map.Contains(name) ? map[name] : null,
                IList list => int.TryParse(name, out int i) && i >= 0 && i < list.Count ? list[i] : null,
                _ => R(settings, name)
            };
            if (settings == null) break;
        }
        return settings;
    }

    private static object? Resolve(ActionRef action, Dictionary<string, object> modules)
    {
        if (action.format == "vanilla" && action.source == "Celeste") {
            var name = action.actionPath switch {
                "/Confirm" => "MenuConfirm", "/Cancel" => "MenuCancel", "/Journal" => "MenuJournal",
                "/QuickRestart" => "QuickRestart", "/DemoDash" => "CrouchDash",
                "/Jump" => "Jump", "/Dash" => "Dash", "/Grab" => "Grab", "/Talk" => "Talk", "/Pause" => "Pause",
                _ => ""
            };
            return name == "" ? null : R(input, name);
        }
        if (action.format != "standard" || !modules.TryGetValue(action.source, out var module)) return null;
        return R(ResolvePath(R(module, "_Settings"), action.actionPath), "Button");
    }

    private static void RefreshTargets()
    {
        var modules = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        if (R(everest, "Modules") is IEnumerable all) foreach (var module in all)
            if (module != null && R(R(module, "Metadata"), "Name") is string name) modules[name] = module;
        var next = new Dictionary<string, object[]>();
        foreach (var definition in definitions.Where(d => d.enabled)) {
            var resolved = new List<object>();
            foreach (var action in definition.actions) {
                try {
                    var button = Resolve(action, modules);
                    if (GameControls.Is(button, "Monocle.VirtualButton")) resolved.Add(button!);
                } catch (Exception) { /* A stale member/mod getter cannot break other bindings. */ }
            }
            next[definition.id] = resolved.Distinct(ReferenceEqualityComparer.Instance).ToArray();
        }
        if (next.Count != targets.Count || next.Any(pair => !targets.TryGetValue(pair.Key, out var old) ||
            !pair.Value.SequenceEqual(old, ReferenceEqualityComparer.Instance))) {
            state.Clear(); epoch = session + ":" + ++generation;
        }
        targets = next;
    }

    private static void Context()
    {
        var next = R(engine, "Scene");
        var nextUI = R(next, "Current");
        var nextMode = GameControls.Classify(next);
        if (!ReferenceEquals(next, scene) || !ReferenceEquals(nextUI, ui) || nextMode != mode) {
            scene = next; ui = nextUI; mode = nextMode;
            epoch = session + ":" + ++generation;
            state.Clear();
        }
        paused = R(scene, "Paused") is true;
    }

    internal static void BeforeUpdate()
    {
        if (!installed) return;
        try {
            Context();
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (now - refreshedAt >= 250) { RefreshTargets(); refreshedAt = now; }
            state.BeginFrame();
            // One transition per game frame retains even down/up within a single Android tick.
            while (incoming.TryDequeue(out var command)) {
                if (command.epoch != epoch || !GameTouch.Fresh(command.sentAt, now)) continue;
                state.Apply(command.held, targets, command.sentAt);
                break;
            }
            state.Expire(now);
            if (mode is "loading" or "transition" or "naming" or "search" || R(minput, "Disabled") is true)
                state.Clear();
        } catch (Exception) { state.Clear(); }
    }

    internal static object Capture()
    {
        if (installed) Context();
        return new { epoch, buttons = definitions.Select((d, i) => new View(d.id, d.label, -i - 1,
            d.enabled && targets.TryGetValue(d.id, out var value) && value.Length > 0, d.icon)).Where((_, i) => definitions[i].enabled).ToArray() };
    }

    private static bool Active => installed && R(minput, "Disabled") is not true &&
        ReferenceEquals(scene, R(engine, "Scene")) && ReferenceEquals(ui, R(scene, "Current")) && (R(scene, "Paused") is true) == paused;
    private static bool Check<T>(Func<T, bool> original, T button) where T : class => original(button) || Active && state.Held.Contains(button);
    private static bool Released<T>(Func<T, bool> original, T button) where T : class => original(button) || Active && state.Released.Contains(button);
    private static bool Pressed<T>(Func<T, bool> original, T button) where T : class {
        bool result = original(button);
        if (!Active || !state.Pressed.Contains(button)) return result;
        if (R(button, "AutoConsumeBuffer") is true) state.Pressed.Remove(button);
        return true;
    }
    private static void Consume<T>(Action<T> original, T button) where T : class { original(button); state.Pressed.Remove(button); }
}

// Shared actions are held until the last virtual-button owner releases them.
internal sealed class ModButtonState
{
    internal HashSet<object> Held { get; } = new(ReferenceEqualityComparer.Instance);
    internal HashSet<object> Pressed { get; } = new(ReferenceEqualityComparer.Instance);
    internal HashSet<object> Released { get; } = new(ReferenceEqualityComparer.Instance);
    private long updated;
    internal void BeginFrame() { Pressed.Clear(); Released.Clear(); }
    internal void Apply(IEnumerable<string> ids, Dictionary<string, object[]> targets, long sentAt) {
        var next = new HashSet<object>(ReferenceEqualityComparer.Instance);
        foreach (var id in ids) if (id != null && targets.TryGetValue(id, out var values)) next.UnionWith(values);
        Pressed.UnionWith(next.Except(Held, ReferenceEqualityComparer.Instance));
        Released.UnionWith(Held.Except(next, ReferenceEqualityComparer.Instance));
        Held.Clear(); Held.UnionWith(next); updated = sentAt;
    }
    internal void Expire(long now) { if (now - updated > 1000) Clear(); }
    internal void Clear() { Held.Clear(); Pressed.Clear(); Released.Clear(); }
}
