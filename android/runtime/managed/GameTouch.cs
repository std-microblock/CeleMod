using System.Collections;
using System.Collections.Concurrent;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.Json;

// All reflection, hit testing and callbacks run on Engine.Update, never the IO thread.
// Coordinates are the game's HUD coordinates, transformed through its actual viewport.
internal static partial class GameTouch
{
    internal sealed record Box(float x, float y, float w, float h) {
        internal bool Contains(float px, float py) => px >= x && py >= y && px <= x + w && py <= y + h;
    }
    internal sealed record Target(string id, Box rect, string kind, string label, string text = "", int maxLength = 128);
    internal sealed record Snapshot(string epoch, string kind, Box viewport, Target[] targets);
    internal sealed record Command(long seq, string epoch, string id, string action, float x = 0, float y = 0,
        float value = 0, string text = "", long sentAt = 0);
    private sealed record LiveTarget(Target View, object Owner, Action<Command> Run);
    private static readonly List<LiveTarget> targets = new();
    private static readonly ConcurrentQueue<Command> incoming = new();
    private static readonly HashSet<object> pressed = new(ReferenceEqualityComparer.Instance);
    private static Type? engineType, inputType, fontType;
    private static object? scene, current, root;
    private static object? pressedScene, pressedUI;
    private static string epoch = "", kind = "", signature = "";
    private static long generation, lastSequence, lastAction;
    private static bool installed, failed;
    private static Box viewport = new(0, 0, 1, 1);
    private static float hudWidth = 1920, hudHeight = 1080;
    private static readonly string session = Guid.NewGuid().ToString("N");
    private const BindingFlags Flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static;
    private static object? R(object? o, string n) => GameControls.Read(o, n);
    private static bool Is(object? o, string n) => GameControls.Is(o, "Celeste." + n);
    private static bool B(object? o, string n) => R(o, n) is true;
    private static float N(object? o, string n, float fallback = 0) => R(o, n) is IConvertible v ? v.ToSingle(null) : fallback;
    private static string S(object? o, string n) => R(o, n)?.ToString() ?? "";
    private static List<object> List(object? o) => o is IEnumerable e ? e.Cast<object>().Where(x => x != null).ToList() : new();
    private static string Identity(object? o) => o == null ? "null" : RuntimeHelpers.GetHashCode(o).ToString();
    private static MethodInfo? Method(object? o, string name, int count) {
        for (var type = o as Type ?? o?.GetType(); type != null; type = type.BaseType) {
            var method = type.GetMethods(Flags | BindingFlags.DeclaredOnly)
                .FirstOrDefault(m => m.Name == name && m.GetParameters().Length == count);
            if (method != null) return method;
        }
        return null;
    }
    private static object? Call(object? o, string name, params object?[] args) {
        // Arity alone selects Measure(char) for a string (and can select the
        // wrong atlas indexer). Match argument types before invoking overloads.
        for (var type = o as Type ?? o?.GetType(); type != null; type = type.BaseType) {
            var method = type.GetMethods(Flags | BindingFlags.DeclaredOnly).FirstOrDefault(m =>
                m.Name == name && !m.ContainsGenericParameters && m.GetParameters().Length == args.Length &&
                m.GetParameters().Select((p, i) => args[i] == null
                    ? !p.ParameterType.IsValueType || Nullable.GetUnderlyingType(p.ParameterType) != null
                    : p.ParameterType.IsInstanceOfType(args[i])).All(matches => matches));
            if (method != null) return method.Invoke(o is Type ? null : o, args);
        }
        return null;
    }
    private static void Set(object o, string name, object value) {
        for (var type = o.GetType(); type != null; type = type.BaseType) {
            var f = type.GetField(name, Flags | BindingFlags.DeclaredOnly);
            if (f != null) { f.SetValue(o, value); return; }
            var p = type.GetProperty(name, Flags | BindingFlags.DeclaredOnly);
            if (p?.SetMethod != null) { p.SetValue(o, value); return; }
        }
        throw new MissingMemberException(o.GetType().FullName, name);
    }
    private static void Callback(object? o, string name) { if (R(o, name) is Delegate d) d.DynamicInvoke(); }
    private static float X(object? o) => N(R(o, "Position"), "X");
    private static float Y(object? o) => N(R(o, "Position"), "Y");
    private static float Measure(string text) => N(Call(fontType, "Measure", text), "X", text.Length * 32);
    private static float LineHeight => N(fontType, "LineHeight", 64);

    internal static void Install(Assembly game, Type engine, Type input, string path) {
        try {
            engineType = engine; inputType = input; fontType = game.GetType("Celeste.ActiveFont");
            var button = game.GetType("Monocle.VirtualButton", true)!;
            StartupHook.Patch(button.GetProperty("Pressed")!.GetMethod!, nameof(ButtonPressed), typeof(GameTouch), true);
            foreach (var name in new[] { "ConsumeBuffer", "ConsumePress" }) {
                var consume = button.GetMethod(name, Flags);
                if (consume != null) StartupHook.Patch(consume, nameof(Consumed), typeof(GameTouch), true);
            }
            installed = true;
            _ = Task.Run(async () => {
                string last = "";
                while (true) {
                    try {
                        var info = new FileInfo(path + ".touch");
                        if (info.Exists && info.Length <= 65536) {
                            var raw = await File.ReadAllTextAsync(info.FullName);
                            if (raw != last) {
                                var commands = JsonSerializer.Deserialize<Command[]>(raw);
                                if (commands is { Length: <= 32 }) foreach (var command in commands) {
                                    if (command == null) continue;
                                    if (command.seq <= lastSequence) continue;
                                    lastSequence = command.seq;
                                    if (incoming.Count < 32) incoming.Enqueue(command);
                                }
                                last = raw;
                            }
                        }
                    } catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException) { }
                    await Task.Delay(16);
                }
            });
            Console.WriteLine("[CeleMod] Direct UI touch connected (viewport + semantic targets).");
        } catch (Exception e) { Console.WriteLine("[CeleMod] Direct touch unavailable: " + e); }
    }

    private static void ButtonPressed(object __instance, ref bool __result) {
        if (pressed.Contains(__instance) && ReferenceEquals(pressedScene, R(engineType, "Scene")) &&
            ReferenceEquals(pressedUI, R(pressedScene, "Current"))) __result = true;
    }
    private static void Consumed(object __instance) => pressed.Remove(__instance);
    private static void Press(string binding) {
        var button = R(inputType, binding);
        if (button == null && inputType?.Assembly.GetType("Celeste.Mod.Core.CoreModule") is Type core)
            button = R(R(R(core, "Settings"), binding), "Button");
        if (button is object b) {
            pressedScene = scene; pressedUI = current; pressed.Add(b);
        }
    }

    internal static void Pump() {
        pressed.Clear(); // A semantic press lives for exactly one game update.
        if (!installed || incoming.IsEmpty) return;
        try {
            Refresh(R(engineType, "Scene"));
            while (incoming.TryDequeue(out var command)) {
                if (!Accept(command, epoch) || !Fresh(command.sentAt, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())) continue;
                var target = targets.FirstOrDefault(t => t.View.id == command.id);
                if (target == null) continue;
                if (command.action == "tap" && !target.View.rect.Contains(command.x, command.y)) continue;
                if (command.action is "tap" or "text") {
                    // Prevent a double tap from accepting the next destructive confirmation.
                    if (Environment.TickCount64 - lastAction < 180) continue;
                    lastAction = Environment.TickCount64;
                }
                target.Run(command);
                // Never process a batch against a UI that a previous callback replaced.
                Refresh(R(engineType, "Scene"));
            }
        } catch (Exception e) {
            if (!failed) Console.WriteLine("[CeleMod] Direct touch action rejected; keeping keyboard fallback: " + e);
            failed = true; targets.Clear(); kind = ""; pressed.Clear();
        }
    }
    internal static bool Accept(Command c, string expected) => c.epoch == expected &&
        c.id is { Length: > 0 and <= 160 } && c.text is { Length: <= 1024 } &&
        float.IsFinite(c.x) && float.IsFinite(c.y) && float.IsFinite(c.value) &&
        c.action is "tap" or "adjust" or "scroll" or "swipe" or "swipeY" or "text";
    internal static bool Fresh(long sent, long now) => sent > 0 && sent <= now + 100 && now - sent <= 1500;

    internal static Snapshot? Capture(object? next) {
        if (!installed) return null;
        try { Refresh(next); return kind == "" ? null : new(epoch, kind, viewport, targets.Select(t => t.View).ToArray()); }
        catch (Exception e) {
            if (!failed) Console.WriteLine("[CeleMod] Unsupported direct UI layout: " + e.Message);
            failed = true; return null;
        }
    }
    // Exposed to synthetic tests; no proprietary assemblies needed.
    internal static Snapshot? Inspect(object? next) {
        Refresh(next);
        return kind == "" ? null : new(epoch, kind, viewport, targets.Select(t => t.View).ToArray());
    }
    internal static void TestCommand(Command command) {
        if (!Accept(command, epoch)) return;
        targets.FirstOrDefault(t => t.View.id == command.id)?.Run(command);
    }

    private static void Refresh(object? next) {
        scene = next; current = R(scene, "Current"); targets.Clear(); kind = ""; root = current ?? scene;
        var mode = GameControls.Classify(scene);
        hudWidth = N(engineType, "Width", 1920); hudHeight = N(engineType, "Height", 1080);
        var vp = R(engineType, "Viewport");
        var pp = R(R(R(engineType, "Graphics"), "GraphicsDevice"), "PresentationParameters");
        float bw = N(pp, "BackBufferWidth"), bh = N(pp, "BackBufferHeight");
        if (bw > 0 && bh > 0) viewport = new(N(vp, "X") / bw, N(vp, "Y") / bh, N(vp, "Width") / bw, N(vp, "Height") / bh);
        if (mode is "gameplay" or "loading" or "pico8" or "fallback") { FinishSignature(mode); return; }
        // An unknown modal must not expose clickable UI underneath it.
        if (R(scene, "Overlay") != null) { FinishSignature("overlay:" + Identity(R(scene, "Overlay"))); return; }
        var menus = List(R(scene, "Entities")).Where(e => Is(e, "TextMenu") && B(e, "Focused") && B(e, "Visible") && B(e, "Active")).ToList();
        if (Is(current, "Mod.UI.OuiMapSearch") && B(current, "Focused")) BuildSearch(current!);
        else if (menus.Count > 0) {
            // Lowest depth renders last; two simultaneous focused mod menus are ambiguous.
            if (menus.Count == 1) { root = menus[0]; BuildMenu(root); }
        }
        // Initial title bypasses Overworld's transition coroutine, so Focused can
        // legitimately be false there; the vanilla gate is Selected + !hideConfirmButton.
        else if (mode == "title" && current != null && B(current, "Visible") && !B(current, "hideConfirmButton")) Continue(current);
        // FileSelect is an invisible controller; its Slot entities render the UI.
        // Keep the focus gate, but use the slots' visibility inside that adapter.
        else if (current != null && B(current, "Focused") && B(current, "Active") &&
            (B(current, "Visible") || Is(current, "OuiFileSelect"))) {
            if (Is(current, "OuiMainMenu")) BuildMain(current);
            else if (Is(current, "OuiFileSelect")) BuildFiles(current);
            else if (Is(current, "OuiChapterSelect")) BuildChapters(current);
            else if (Is(current, "OuiChapterPanel")) BuildPanel(current);
            else if (Is(current, "OuiJournal")) {
                kind = "journal";
                Add("journal", current, new(0, 0, hudWidth, hudHeight), "swipe", "滑动翻页", c => {
                    if (c.action == "swipe" && !B(current, "turningPage") && !B(current, "PageTurningLocked"))
                        Press(c.value > 0 ? "MenuRight" : "MenuLeft");
                    else if (c.action == "swipeY" && !B(current, "turningPage")) Press(c.value > 0 ? "MenuDown" : "MenuUp");
                });
            }
            else if (mode == "naming") BuildNaming(current);
            else if (mode == "title") Continue(current);
        }
        else if (mode is "dialogue" or "complete") Continue(scene!);
        FinishSignature(mode);
    }
    private static void FinishSignature(string mode) {
        var next = Identity(scene) + ":" + Identity(current) + ":" + Identity(root) + ":" + mode + ":" + kind + ":" +
            string.Join(";", targets.Select(t => t.View.id + ":" + Identity(t.Owner)));
        if (next != signature) { signature = next; epoch = session + ":" + ++generation; }
        if (targets.Count == 0) kind = "";
    }
    private static void Add(string id, object owner, Box box, string type, string label, Action<Command> action,
        string text = "", int maxLength = 128) {
        if (!float.IsFinite(box.x + box.y + box.w + box.h) || box.w <= 0 || box.h <= 0) return;
        var rect = new Box(box.x / hudWidth, box.y / hudHeight, box.w / hudWidth, box.h / hudHeight);
        // Keep offscreen targets in the identity signature: scrolling must not cancel
        // an in-flight drag just because another row entered the viewport.
        targets.Add(new(new(id, rect, type, label, text, Math.Clamp(maxLength, 1, 1024)), owner, action));
    }
    private static void Continue(object owner) {
        kind = "continue";
        Add("continue", owner, new(0, 0, hudWidth, hudHeight), "tap", "轻点继续", c => {
            if (c.action == "tap") Press("MenuConfirm");
        }); // Uses the game's advance gating; never calls skip/end-cutscene methods.
    }
}
