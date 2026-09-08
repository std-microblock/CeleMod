using System.Collections;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;

// Observe on the game thread, publish only immutable snapshots to Android. No
// game references, setting changes, or guesses based on which key was pressed.
internal static class GameControls
{
    private static Type? engine, input, settings, talk;
    private static string? path, pending;
    private static volatile string? lastJson;
    private static long nextSample;
    private static int writing;
    private static bool reportedError;
    private const BindingFlags Flags = BindingFlags.Public | BindingFlags.NonPublic |
        BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;
    private static readonly Dictionary<(Type, string), MemberInfo?> Members = new();

    internal static void Install()
    {
        path = Environment.GetEnvironmentVariable("CELEMOD_CONTROLS_PATH");
        if (string.IsNullOrEmpty(path)) return;
        try {
            var file = Path.Combine(AppContext.BaseDirectory, "Celeste.dll");
            if (!File.Exists(file)) file = Path.Combine(AppContext.BaseDirectory, "Celeste.exe");
            var game = AssemblyLoadContext.Default.LoadFromAssemblyPath(file);
            engine = game.GetType("Monocle.Engine", true);
            input = game.GetType("Celeste.Input", true);
            settings = game.GetType("Celeste.Settings", true);
            talk = game.GetType("Celeste.TalkComponent");
            var update = engine!.GetMethods(Flags).Single(m => m.Name == "Update" && m.GetParameters().Length == 1);
            StartupHook.Patch(update, nameof(AfterUpdate), typeof(GameControls), postfix: true);
            Console.WriteLine("[CeleMod] Contextual touch controls connected to Engine.Update.");
        } catch (Exception e) {
            Console.WriteLine("[CeleMod] Contextual controls unavailable; using fallback controls: " + e);
        }
    }

    internal static object? Read(object? target, string name)
    {
        if (target == null) return null;
        var type = target as Type ?? target.GetType();
        if (!Members.TryGetValue((type, name), out var member)) {
            for (var current = type; current != null && member == null; current = current.BaseType)
                member = (MemberInfo?)current.GetField(name, Flags) ?? current.GetProperty(name, Flags);
            Members[(type, name)] = member;
        }
        var instance = target is Type ? null : target;
        return member switch {
            FieldInfo f => f.GetValue(instance),
            PropertyInfo p => p.GetValue(instance),
            _ => null
        };
    }

    private static bool Yes(object? target, string name) => Read(target, name) is true;
    internal static bool Is(object? target, string name)
    {
        for (var type = target?.GetType(); type != null; type = type.BaseType)
            if (type.FullName == name) return true;
        return false;
    }

    internal static string Classify(object? scene)
    {
        if (scene == null || Is(scene, "Celeste.GameLoader") || Is(scene, "Celeste.LevelLoader") ||
            Is(scene, "Celeste.OverworldLoader")) return "loading";
        if (Is(scene, "Celeste.Pico8.Emulator")) return "pico8";
        if (Is(scene, "Celeste.Overworld")) {
            if (Read(scene, "Overlay") != null) return "menu";
            var ui = Read(scene, "Current") ?? Read(scene, "Next") ?? Read(scene, "Last");
            if (Is(ui, "Celeste.OuiTitleScreen")) return "title";
            if (Is(ui, "Celeste.OuiJournal")) return "journal";
            if (Is(ui, "Celeste.Mod.UI.OuiMapSearch")) return "search";
            if (Is(ui, "Celeste.OuiFileNaming") || Is(ui, "Celeste.Mod.UI.OuiModOptionString") ||
                Is(ui, "Celeste.Mod.UI.OuiNumberEntry")) return "naming";
            if (Is(ui, "Celeste.OuiChapterSelect") || Is(ui, "Celeste.OuiChapterPanel")) return "chapter";
            return "menu"; // Includes Everest and third-party Oui menus.
        }
        if (Is(scene, "Celeste.Level")) {
            if (Yes(scene, "Paused")) return Yes(scene, "PauseMainMenuOpen") ? "pause" : "pause_menu";
            if (Read(scene, "Overlay") != null) return "menu";
            bool dialogue = false;
            if (Read(scene, "Entities") is IEnumerable entities) {
                foreach (var entity in entities) {
                    if (!Yes(entity, "Visible") || !Yes(entity, "Active")) continue;
                    // A focused mod TextMenu takes precedence over a textbox underneath it.
                    if (Is(entity, "Celeste.TextMenu") && Yes(entity, "Focused")) return "menu";
                    if (Is(entity, "Celeste.Textbox") && Yes(entity, "Opened")) dialogue = true;
                }
            }
            if (dialogue) return "dialogue";
            // Keep movement during non-dialogue cutscenes/transitions: mods and
            // several vanilla sequences allow player control while InCutscene.
            return "gameplay";
        }
        if (Is(scene, "Celeste.LevelEnter") || Is(scene, "Celeste.AreaComplete") || Is(scene, "Celeste.LevelExit") ||
            Is(scene, "Celeste.Credits")) return "complete";
        return "fallback"; // Unknown mod scenes must not lose gameplay inputs.
    }

    private static string[] Keyboard(object? binding) => Read(binding, "Keyboard") is IEnumerable keys
        ? keys.Cast<object>().Select(k => k.ToString()!).Where(k => k != "None").ToArray()
        : Array.Empty<string>();

    private static Dictionary<string, string[]> Bindings()
    {
        var result = new Dictionary<string, string[]>();
        foreach (var name in new[] { "Jump", "Dash", "Grab", "Talk", "Pause", "MenuConfirm", "MenuCancel",
            "MenuJournal", "MenuUp", "MenuDown", "MenuLeft", "MenuRight" })
            result[name] = Keyboard(Read(Read(input, name), "Binding"));
        var instance = Read(settings, "Instance");
        foreach (var name in new[] { "Up", "Down", "Left", "Right" })
            result[name] = Keyboard(Read(instance, name));
        return result;
    }

    private static void AfterUpdate()
    {
        var now = Environment.TickCount64;
        if (now < nextSample) return;
        nextSample = now + 50;
        try {
            var scene = Read(engine, "Scene");
            var mode = Classify(scene);
            var current = Read(scene, "Current");
            var json = JsonSerializer.Serialize(new {
                version = 1, mode,
                scene = scene?.GetType().FullName ?? "",
                ui = current?.GetType().FullName ?? "",
                canTalk = mode == "gameplay" && Read(talk, "PlayerOver") is object nearby && Yes(nearby, "Enabled"),
                keyboard = mode == "naming" && Yes(current, "UseKeyboardInput") || mode == "search" && Yes(current, "Searching"),
                bindings = Bindings()
            });
            if (json == lastJson) return;
            lastJson = json;
            Interlocked.Exchange(ref pending, json);
            StartWriter();
        } catch (Exception e) {
            if (!reportedError) Console.WriteLine("[CeleMod] Controls state could not be read: " + e);
            reportedError = true; // A mod's reflection failure must never interrupt gameplay.
        }
    }

    private static void StartWriter()
    {
        if (Interlocked.CompareExchange(ref writing, 1, 0) != 0) return;
        ThreadPool.QueueUserWorkItem(_ => {
            try {
                while (Interlocked.Exchange(ref pending, null) is string json) {
                    try {
                        File.WriteAllText(path + ".tmp", json);
                        File.Move(path + ".tmp", path!, overwrite: true);
                    } catch (IOException) { lastJson = null; }
                      catch (UnauthorizedAccessException) { lastJson = null; }
                }
            } finally {
                Interlocked.Exchange(ref writing, 0);
                if (Volatile.Read(ref pending) != null) StartWriter();
            }
        });
    }
}
