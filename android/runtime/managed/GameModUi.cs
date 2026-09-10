using System.Collections;

// Optional, read-only discovery. Never load a Mod assembly or instantiate its context.
internal static class GameModUi
{
    internal const string Collab = "Celeste.Mod.CollabUtils2.";
    private static Type? collabHelper, collabModule, miaoModule;
    private static long nextDiscovery;
    internal enum EntityUi { None, TextMenu, Textbox, LobbyMap, AssistSkip }
    private static readonly Dictionary<Type, EntityUi> entityKinds = new();
    private static object? R(object? o, string n) => GameControls.Read(o, n);

    private static void Discover() {
        if (collabHelper != null && collabModule != null && miaoModule != null) return;
        if (Environment.TickCount64 < nextDiscovery) return;
        nextDiscovery = Environment.TickCount64 + 1000;
        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies()) {
            collabHelper ??= assembly.GetType(Collab + "UI.InGameOverworldHelper");
            collabModule ??= assembly.GetType(Collab + "CollabModule");
            miaoModule ??= assembly.GetType("Celeste.Mod.MiaoNet.MiaoNetModule");
        }
    }

    internal static object? MiaoContext {
        get { Discover(); return R(R(miaoModule, "Instance"), "miaoNetContext"); }
    }
    internal static object? Chat(object? scene) {
        if (!GameControls.Is(scene, "Celeste.Level") && !GameControls.Is(scene, "Celeste.Overworld")) return null;
        var context = MiaoContext;
        var chat = R(context, "ChatComponent");
        return R(context, "HasConnection") is true && R(chat, "Active") is true ? chat : null;
    }
    internal static object? Wrapped(object? scene) {
        if (!GameControls.Is(scene, "Celeste.Level") || R(scene, "Paused") is true || R(scene, "Overlay") != null) return null;
        Discover();
        var wrapper = R(collabHelper, "overworldWrapper");
        return wrapper != null && ReferenceEquals(R(wrapper, "Scene"), scene) && R(wrapper, "Initialized") is true &&
            R(wrapper, "Active") is true && R(wrapper, "Visible") is true &&
            GameControls.Is(R(wrapper, "WrappedScene"), "Celeste.Overworld") ? R(wrapper, "WrappedScene") : null;
    }
    // One cached lookup per lobby entity, not four inheritance-cache lookups.
    internal static EntityUi Kind(object entity) {
        var type = entity.GetType();
        if (entityKinds.TryGetValue(type, out var kind)) return kind;
        kind = GameControls.Is(entity, Collab + "UI.LobbyMapUI") ? EntityUi.LobbyMap :
            GameControls.Is(entity, Collab + "UI.AssistSkipConfirmUI") ? EntityUi.AssistSkip :
            GameControls.Is(entity, "Celeste.TextMenu") ? EntityUi.TextMenu :
            GameControls.Is(entity, "Celeste.Textbox") ? EntityUi.Textbox : EntityUi.None;
        return entityKinds[type] = kind;
    }
    internal static bool IsModal(object entity) => Kind(entity) is EntityUi.LobbyMap or EntityUi.AssistSkip;

    internal static void AddBindings(Dictionary<string, string[]> bindings, object? scene, string mode) {
        Discover();
        void Add(string name, object? binding) {
            if (R(binding, "Keyboard") is IEnumerable keys)
                bindings[name] = keys.Cast<object>().Select(k => k.ToString()!).Where(k => k != "None").ToArray();
        }
        if (mode == "gameplay") {
            // Keep bindings stable while the player-list hold owns component focus;
            // removing even the chat entry would release all Android held keys.
            if (R(MiaoContext, "HasConnection") is true) {
                var settings = R(miaoModule, "Settings");
                Add("MiaoChat", R(R(settings, "ChatButton"), "Binding"));
                Add("MiaoPlayers", R(R(settings, "PlayerListButton"), "Binding"));
            }
            // Only offer the map in lobbies that actually have a map controller.
            if (R(scene, "Entities") is IEnumerable entities && entities.Cast<object>().Any(e =>
                GameControls.Is(e, Collab + "Entities.LobbyMapController")))
                Add("CollabMap", R(R(R(R(collabModule, "Instance"), "Settings"), "DisplayLobbyMap"), "Binding"));
        }
    }
}
