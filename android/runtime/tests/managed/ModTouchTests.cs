using System.Reflection;
using Celeste;
using Celeste.Mod.CollabUtils2.UI;
using Celeste.Mod.MiaoNet;

static class ModTouchTests
{
    internal static void Run() {
        int count = 0;
        void Check(bool ok, string message) { if (!ok) throw new Exception(message); count++; }
        var flags = BindingFlags.NonPublic | BindingFlags.Static;
        typeof(GameTouch).GetField("fontType", flags)!.SetValue(null, typeof(ActiveFont));
        typeof(GameTouch).GetField("inputType", flags)!.SetValue(null, typeof(Input));
        var presses = (HashSet<object>)typeof(GameTouch).GetField("pressed", flags)!.GetValue(null)!;
        void Send(GameTouch.Snapshot s, string id, string action = "tap", float x = 0, float y = 0, string text = "", float value = 0) =>
            GameTouch.TestCommand(new(1, s.epoch, id, action, x, y, value, text));
        try {
            var level = new Level();
            var panel = new OuiChapterPanel { options = { new() } };
            var overworld = new Overworld { Current = panel };
            var wrapper = new TestWrapper { Scene = level, WrappedScene = overworld };
            InGameOverworldHelper.overworldWrapper = wrapper;
            Check(GameControls.Classify(level) == "chapter", "CU2 nested chapter panel replaces gameplay controls");
            var state = GameTouch.Inspect(level)!;
            Check(state.targets.Any(t => t.id == "panel/0"), "CU2 nested panel uses real vanilla targets");
            presses.Clear(); Send(state, "panel/0");
            Check(presses.Contains(Input.MenuConfirm), "nested chapter panel uses semantic confirm");
            typeof(GameTouch).GetField("engineType", flags)!.SetValue(null, typeof(TestEngine));
            TestEngine.Scene = level;
            var buttonPressed = typeof(GameTouch).GetMethod("ButtonPressed", flags)!.MakeGenericMethod(typeof(object))
                .CreateDelegate<Func<Func<object, bool>, object, bool>>();
            Check(buttonPressed(_ => false, Input.MenuConfirm), "nested UI press works while engine scene is still Level");
            overworld.Current = new OuiJournal();
            Check(!buttonPressed(_ => false, Input.MenuConfirm), "nested UI replacement rejects pending confirmation");
            Check(GameControls.Classify(level) == "journal" && GameTouch.Inspect(level)?.kind == "journal", "CU2 in-lobby journal supports gestures");
            var journalState = GameTouch.Inspect(level)!;
            Check(journalState.epoch != state.epoch, "nested UI change invalidates old epoch");
            overworld.transitioning = true;
            Check(GameControls.Classify(level) == "transition" && GameTouch.Inspect(level) == null, "wrapped transitions cannot be tapped");
            overworld.transitioning = false;
            level.Paused = true; level.PauseMainMenuOpen = true;
            Check(GameControls.Classify(level) == "pause", "real pause takes precedence over wrapped UI");
            level.Paused = false;
            wrapper.Initialized = false;
            Check(GameControls.Classify(level) == "gameplay", "uninitialized wrapper is not interactive");
            wrapper.Initialized = true; wrapper.Scene = new Level();
            Check(GameControls.Classify(level) == "gameplay", "stale wrapper from another level is ignored");
            InGameOverworldHelper.overworldWrapper = null;

            var menu = new TextMenu { Focused = true, Items = { new() } };
            var map = new LobbyMapUI();
            level.Entities.Add(menu); level.Entities.Add(map);
            Check(GameControls.Classify(level) == "lobby_map", "CU2 map takes precedence over underlying menus");
            state = GameTouch.Inspect(level)!;
            Check(state.kind == "lobby_map" && state.targets.Single().id == "collab/map", "map never exposes menu underneath");
            var origin = map.actualOrigin;
            Send(state, "collab/map", "pan", .1f, .1f);
            Check(map.actualOrigin.X < origin.X && map.actualOrigin.Y < origin.Y && map.Updates == 1, "drag pans map in HUD coordinates");
            Check(map.selectedWarpIndexes[0] == 1 && map.lastSelectedWarpIndex == 1, "pan selects only an active unlocked warp");
            Check(map.Teleports == 0, "drag never teleports");
            origin = map.actualOrigin;
            map.shouldCentreOrigin = true; Send(state, "collab/map", "pan", .1f);
            Check(map.actualOrigin.Equals(origin), "overview zoom cannot be panned");
            map.shouldCentreOrigin = false; map.translateTimeRemaining = .1f; Send(state, "collab/map", "pan", .1f);
            Check(map.actualOrigin.Equals(origin), "animated focus cannot be panned");
            map.translateTimeRemaining = 0; Send(state, "collab/map", "pan", 5f);
            Check(map.actualOrigin.Equals(origin), "oversized pan delta rejected");
            map.viewOnly = true; map.selectedWarpIndexes[0] = 0; Send(state, "collab/map", "pan", -.1f);
            Check(map.selectedWarpIndexes[0] == 0, "view-only map cannot change teleport selection");
            Check(GameControls.Classify(level) == "lobby_map_view", "read-only maps hide teleport control");
            map.selectedLobbyIndex = 1;
            Check(GameTouch.Inspect(level)!.epoch != state.epoch, "different lobby invalidates an ongoing drag");
            map.focused = false;
            Check(GameControls.Classify(level) == "transition" && GameTouch.Inspect(level) == null, "opening map blocks controls");
            map.focused = true; map.closing = true;
            Check(GameControls.Classify(level) == "transition" && GameTouch.Inspect(level) == null, "closing map blocks controls");
            level.Entities.Remove(map);
            var assist = new AssistSkipConfirmUI(); level.Entities.Add(assist);
            state = GameTouch.Inspect(level)!;
            Check(state.targets.All(t => t.id.StartsWith("collab/assist/")), "assist confirmation blocks underlying menu");
            presses.Clear(); Send(state, "collab/assist/1");
            Check(assist.currentlySelectedOption == 1 && presses.Contains(Input.MenuConfirm), "assist cancellation preserves Mod update callbacks");
            assist.openingEase = .5f;
            Check(GameTouch.Inspect(level) == null, "animating confirmation cannot be tapped");
            level.Entities.Clear();

            var module = new MiaoNetModule(); MiaoNetModule.Instance = module;
            Check(GameModUi.Chat(level) == null && module.ContextCreations == 0, "discovery never constructs a MiaoNet context");
            var context = new TestMiaoContext(); module.miaoNetContext = context;
            var bindings = new Dictionary<string, string[]>();
            GameModUi.AddBindings(bindings, level, "gameplay");
            Check(bindings["MiaoChat"].Single() == "T" && bindings["MiaoPlayers"].Single() == "Tab", "connected Mod exposes live shortcut bindings");
            context.IsSuitableToOpenUI = false;
            var focused = new Dictionary<string, string[]>(); GameModUi.AddBindings(focused, level, "gameplay");
            Check(focused.Keys.SequenceEqual(bindings.Keys), "player list focus does not remove shortcuts and cancel its own hold");
            MiaoNetModule.Settings.ChatButton.Binding.Keyboard.Clear();
            GameModUi.AddBindings(bindings, level, "gameplay");
            Check(bindings["MiaoChat"].Length == 0, "explicitly unbound chat never falls back to T");
            var chat = context.ChatComponent; chat.Active = true;
            level.Paused = true; level.Overlay = new object(); level.Entities.Add(menu);
            Check(GameControls.Classify(level) == "chat", "MiaoNet chat precedes paused level and dummy overlay");
            state = GameTouch.Inspect(level)!;
            Check(state.kind == "chat" && state.targets.Any(t => t.id == "text") && state.targets.All(t => t.id != "menu/0"), "chat exclusively owns touch input");
            Send(state, "text", "text", text: "你好 /help\n");
            Check(chat.inputBox.Text == "你好 /help", "native Unicode text replaces draft and strips control characters");
            Check(chat.Sent == 0 && chat.Active, "filling draft neither sends nor closes chat");
            chat.inputBox.MaxTextLength = 3;
            Send(state, "text", "text", text: "ab😀");
            Check(chat.inputBox.Text == "ab", "length clamp cannot split a surrogate pair");
            Send(state, "chat/tabs", "swipe", value: 1);
            Check(chat.chatMessageBox.TabChanges == 1 && chat.ChannelSyncs == 1, "channel swipe uses Mod tab and channel synchronization");
            Check(GameTouch.Inspect(level)!.epoch == state.epoch, "draft edits preserve the keyboard session epoch");
            chat.Active = false;
            Check(GameTouch.Inspect(level) == null, "closing chat invalidates direct input and respects unknown overlay");
            Send(state, "text", "text", text: "stale");
            Check(chat.inputBox.Text == "ab", "old chat epoch cannot edit after closing");
            context.HasConnection = false; bindings.Clear(); GameModUi.AddBindings(bindings, level, "gameplay");
            Check(bindings.Count == 0, "disconnection removes shortcuts");
            level.Overlay = null; level.Paused = false; level.Entities.Clear();
            var collab = new Celeste.Mod.CollabUtils2.CollabModule(); Celeste.Mod.CollabUtils2.CollabModule.Instance = collab;
            level.Entities.Add(new Celeste.Mod.CollabUtils2.Entities.LobbyMapController());
            GameModUi.AddBindings(bindings, level, "gameplay");
            Check(bindings["CollabMap"].Single() == "M", "lobby controller enables current map binding");
            bindings.Clear(); level.Entities.Clear(); GameModUi.AddBindings(bindings, level, "gameplay");
            Check(bindings.Count == 0, "ordinary maps have no lobby map shortcut");
        } finally {
            MiaoNetModule.Instance = null; InGameOverworldHelper.overworldWrapper = null;
            Celeste.Mod.CollabUtils2.CollabModule.Instance = null;
            typeof(GameTouch).GetField("engineType", flags)!.SetValue(null, null);
            presses.Clear();
        }
        Console.WriteLine($"PASS: {count} CollabUtils2/MiaoNet touch cases.");
    }
    private static class TestEngine { public static object? Scene; }
}

namespace Celeste.Mod.CollabUtils2.UI {
    static class InGameOverworldHelper { public static TestWrapper? overworldWrapper; }
    class TestWrapper : Monocle.Entity { public bool Initialized = true; public object? Scene; public object? WrappedScene; }
    class AssistSkipConfirmUI : Monocle.Entity { public bool opened = true; public float openingEase = 1; public int currentlySelectedOption = 0; }
    class LobbyMapUI : Monocle.Entity {
        public bool focused = true, closing, viewOnly, shouldCentreOrigin;
        public float translateTimeRemaining, scaleTimeRemaining = 0, finalScale = 2;
        public Bounds windowBounds = new(100, 150, 1720, 780);
        public Texture mapTexture = new() { Width = 1920, Height = 1080 };
        public Point actualOrigin = new(.5f, .5f), selectedOrigin = new();
        public List<Warp> activeWarps = new() { new(), new() };
        public int[] selectedWarpIndexes = [0, 0];
        public int selectedLobbyIndex, lastSelectedWarpIndex = 0, Updates, Teleports = 0;
        public int nearestWarpIndexToActualOrigin() => 1;
        public Point originForPosition(Point p) => p;
        public void updateMarkers() => Updates++;
        public class Warp { public Point Position = new(.2f, .3f); }
        public struct Point(float x, float y) { public float X = x, Y = y; }
        public record Bounds(float X, float Y, float Width, float Height);
    }
}
namespace Celeste.Mod.CollabUtils2 {
    class CollabModule { public static CollabModule? Instance; public TestCollabSettings Settings = new(); }
    class TestCollabSettings { public Celeste.Mod.MiaoNet.TestBinding DisplayLobbyMap = new("M"); }
}
namespace Celeste.Mod.CollabUtils2.Entities { class LobbyMapController : Monocle.Entity { } }
namespace Celeste.Mod.MiaoNet {
    class MiaoNetModule {
        public static MiaoNetModule? Instance;
        public static TestMiaoSettings Settings = new();
        public TestMiaoContext? miaoNetContext;
        public int ContextCreations;
        public TestMiaoContext MiaoNetContext { get { ContextCreations++; return miaoNetContext ??= new(); } }
    }
    class TestBinding(string key) { public TestKeys Binding = new(key); }
    class TestKeys(string key) { public List<string> Keyboard = [key]; }
    class TestMiaoSettings { public TestBinding ChatButton = new("T"), PlayerListButton = new("Tab"); }
    class TestMiaoContext {
        public bool HasConnection = true, IsSuitableToOpenUI = true;
        public ChatComponent ChatComponent = new();
    }
    class ChatComponent {
        public bool Active;
        public TestInputBox inputBox = new();
        public TestRenderer textRenderer = new();
        public TestMessages chatMessageBox = new();
        public int Sent = 0, ChannelSyncs;
        public void SyncChatChannelWithTab() => ChannelSyncs++;
    }
    class TestRenderer { public float LineHeight = 32; }
    class TestInputBox {
        public string Text = "";
        public int MaxTextLength = 64;
        public void SetText(string text) => Text = text;
    }
    class TestMessages {
        public int TabChanges;
        public void CycleTabForward() => TabChanges--;
        public void CycleTabBackward() => TabChanges++;
    }
}
