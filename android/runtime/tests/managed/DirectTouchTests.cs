using Celeste;

static class DirectTouchTests {
    static int count;
    static void Check(bool condition, string description) {
        if (!condition) throw new Exception(description);
        count++;
    }
    static GameTouch.Command Tap(GameTouch.Snapshot state, string id, string action = "tap", float value = 0, float x = .5f) =>
        new(1, state.epoch, id, action, x, .5f, value);
    public static void Run() {
        const System.Reflection.BindingFlags privateStatic = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static;
        typeof(GameTouch).GetField("fontType", privateStatic)!.SetValue(null, typeof(ActiveFont));
        typeof(GameTouch).GetField("inputType", privateStatic)!.SetValue(null, typeof(Input));
        var presses = (HashSet<object>)typeof(GameTouch).GetField("pressed", privateStatic)!.GetValue(null)!;
        var menu = new TextMenu { Focused = true };
        var first = new TextMenu.Item(); var second = new TextMenu.Item();
        menu.Items.AddRange(new[] { first, second });
        var level = new Level { Paused = true, Entities = { menu } };
        var state = GameTouch.Inspect(level)!;
        Check(state.kind == "menu" && state.targets.Length == 3, "focused pause menu has rows and scroll surface");
        var rect = state.targets.Single(t => t.id == "menu/0").rect;
        Check(Math.Abs(rect.x - 760f / 1920) < .0001f && Math.Abs(rect.y - 440f / 1080) < .0001f, "real menu position, justify and size");
        int entered = 0, left = 0, clicked = 0;
        first.OnLeave = () => left++; second.OnEnter = () => entered++; second.OnPressed = () => clicked++;
        GameTouch.TestCommand(Tap(state, "menu/1"));
        Check(menu.Selection == 1 && entered == 1 && left == 1 && clicked == 1 && second.Confirmed == 1, "native selection and item callbacks");
        var oldEpoch = state.epoch;
        menu.Position = new(960, -2000);
        state = GameTouch.Inspect(level)!;
        Check(state.epoch == oldEpoch, "scrolling offscreen rows does not invalidate gesture epoch");
        second.Disabled = true;
        state = GameTouch.Inspect(level)!;
        Check(state.targets.All(t => t.id != "menu/1") && state.epoch != oldEpoch, "disabled targets removed and old gestures invalidated");
        GameTouch.TestCommand(new(2, oldEpoch, "menu/1", "tap"));
        Check(clicked == 1, "stale gesture cannot activate disabled item");
        second.Disabled = false; first.Visible = false; menu.Position = new(960, 540);
        state = GameTouch.Inspect(level)!;
        Check(state.targets.All(t => t.id != "menu/0"), "hidden rows do not receive hits");
        first.Visible = true;
        GameTouch.TestCommand(Tap(state, "menu/scroll", "scroll", -4));
        Check(menu.Selection == 0 && clicked == 1, "scroll stops at first row, does not confirm");
        var slider = new TextMenu.Option(); menu.Items.Add(slider);
        state = GameTouch.Inspect(level)!;
        Check(state.targets.Any(t => t.id == "menu/2" && t.kind == "slider"), "options expose drag targets");
        GameTouch.TestCommand(Tap(state, "menu/2", "adjust", x: 1));
        Check(slider.Index == 4 && slider.Changes == 4, "slider invokes value callbacks, clamps endpoint");
        GameTouch.TestCommand(Tap(state, "menu/2", "adjust", x: 0));
        Check(slider.Index == 0 && slider.Changes == 8, "slider can drag back without skipping callbacks");
        level.Overlay = new object();
        Check(GameTouch.Inspect(level) == null, "unknown modal blocks underlying menu");
        level.Overlay = null; level.Entities.Add(new TextMenu { Focused = true });
        Check(GameTouch.Inspect(level) == null, "ambiguous simultaneous mod menus fall back");
        level.Entities.RemoveAt(1); first.Focused = true;
        Check(GameTouch.Inspect(level) == null, "expanded custom submenus fall back instead of guessing children");
        first.Focused = false; menu.Active = false;
        Check(GameTouch.Inspect(level) == null, "inactive menu is never interactive");
        Check(GameTouch.Inspect(new Level()) == null && GameTouch.Inspect(new object()) == null, "gameplay and unknown scenes keep controls");
        Check(GameTouch.Inspect(new Overworld { Current = new OuiTitleScreen() })?.kind == "continue", "initial title can receive touches without Focused");
        Check(GameTouch.Inspect(new Overworld { Current = new OuiTitleScreen { hideConfirmButton = true } }) == null, "hidden title confirm cannot receive taps");
        var main = new OuiMainMenu();
        var b1 = new MainMenuSmallButton(); var b2 = new MainMenuSmallButton();
        main.Buttons.AddRange(new[] { b1, b2 }); b1.Selected = true; b1.DownButton = b2;
        var mainState = GameTouch.Inspect(new Overworld { Current = main })!;
        Check(mainState.kind == "main" && mainState.targets.Count(t => t.id != "main/scroll") == 2, "main menu buttons expose direct targets");
        GameTouch.TestCommand(Tap(mainState, "main/scroll", "scroll", 1));
        Check(b2.Selected && b2.Confirmed == 0, "main menu slide selects neighbor without activating");
        var b2Target = mainState.targets.Last();
        GameTouch.TestCommand(Tap(mainState, b2Target.id));
        Check(b2.Confirmed == 1, "main menu target invokes Confirm");
        Check(ActiveFont.StringMeasurements > 0, "real font string overload used instead of Measure(char)");
        b2.Visible = false;
        mainState = GameTouch.Inspect(new Overworld { Current = main })!;
        Check(mainState.targets.Any(t => t.id == b2Target.id), "main renders its buttons directly regardless of Entity.Visible");
        main.Focused = false;
        Check(GameTouch.Inspect(new Overworld { Current = main }) == null, "main transition cannot be tapped");
        var files = new OuiFileSelect { Visible = false };
        var slot = new OuiFileSelectSlot(); files.Slots.Add(slot);
        var fileScene = new Overworld { Current = files };
        var fileState = GameTouch.Inspect(fileScene)!;
        Check(fileState.targets.Any(t => t.id == "file/0"), "invisible file controller exposes its visible slot entities");
        var card = fileState.targets.Single(t => t.id == "file/0").rect;
        Check(Math.Abs(card.w * 1920 - 1320) < .01f, "card bounds include highlighted card and ticket displacement");
        GameTouch.TestCommand(Tap(fileState, "file/0"));
        Check(files.SlotSelected && files.SelectCalls == 1, "card tap selects the real slot");
        slot.buttons.Add(new()); slot.selectedEase = 1;
        fileState = GameTouch.Inspect(fileScene)!;
        Check(fileState.targets.Any(t => t.id == "file/action/0"), "selected slot exposes its action buttons");
        presses.Clear(); GameTouch.TestCommand(Tap(fileState, "file/action/0"));
        Check(presses.Contains(Input.MenuConfirm), "file action uses semantic confirm rather than bypassing game confirmation");
        slot.Visible = false;
        Check(GameTouch.Inspect(fileScene) == null, "hidden selected card has no active buttons");
        files.SlotSelected = false; slot.Visible = true; files.Focused = false;
        Check(GameTouch.Inspect(fileScene) == null, "unfocused file controller cannot receive taps");
        Check(GameTouch.Inspect(new Level { Entities = { new Textbox { Opened = true } } })?.kind == "continue", "dialogue supports tap advance");
        Check(GameTouch.Inspect(new AreaComplete())?.kind == "continue", "completion supports tap advance");
        Check(GameTouch.Inspect(new Overworld { Current = new OuiJournal() })?.kind == "journal", "journal exposes swipe surface");
        var panel = new OuiChapterPanel(); panel.options.Add(new());
        var panelState = GameTouch.Inspect(new Overworld { Current = panel })!;
        Check(panelState.targets.Any(t => t.id == "panel/0" && Math.Abs(t.rect.x - 940f / 1920) < .001f), "chapter tabs use GetRenderPosition and actual texture size");
        var chapters = new OuiChapterSelect(); chapters.icons.Add(new() { Area = 1 }); chapters.icons.Add(new() { Area = 2, hidden = true });
        var chapterState = GameTouch.Inspect(new Overworld { Current = chapters })!;
        Check(chapterState.targets.Any(t => t.id == "chapter/1") && chapterState.targets.All(t => t.id != "chapter/2"), "hidden chapters cannot be unlocked by touch");
        chapters.maplistEase = chapters.searchEase = 1;
        chapterState = GameTouch.Inspect(new Overworld { Current = chapters })!;
        var listRect = chapterState.targets.Single(t => t.id == "map-list").rect;
        var searchRect = chapterState.targets.Single(t => t.id == "map-search").rect;
        Check(searchRect.y + searchRect.h <= listRect.y + .00001f, "164px chapter shortcuts have nonoverlapping hit regions");
        Check(Math.Abs((listRect.y + listRect.h / 2) * 1080 - 952) < .01f &&
            Math.Abs((searchRect.y + searchRect.h / 2) * 1080 - 824) < .01f, "shortcut centers match rendering without journal");
        presses.Clear(); GameTouch.TestCommand(Tap(chapterState, "map-list"));
        Check(presses.SetEquals(new[] { Input.ESC }), "lower map-list icon invokes ESC only");
        presses.Clear(); GameTouch.TestCommand(Tap(chapterState, "map-search"));
        Check(presses.SetEquals(new[] { Celeste.Mod.Core.CoreModule.Settings.MenuSearch.Button }), "upper search icon invokes Everest custom binding only");
        chapters.journalEnabled = true; chapters.journalEase = 1;
        chapterState = GameTouch.Inspect(new Overworld { Current = chapters })!;
        Check(Math.Abs(chapterState.targets.Single(t => t.id == "map-list").rect.y * 1080 - 760) < .01f &&
            Math.Abs(chapterState.targets.Single(t => t.id == "map-search").rect.y * 1080 - 632) < .01f, "journal shifts list and search up one slot");
        var naming = new OuiFileNaming();
        var namingState = GameTouch.Inspect(new Overworld { Current = naming })!;
        Check(namingState.targets.Any(t => t.id == "text" && t.kind == "text") && namingState.targets.Any(t => t.id == "letter/0/0"), "naming exposes native text and alphabet targets");
        GameTouch.TestCommand(new(1, namingState.epoch, "text", "text", text: "ABC"));
        Check(naming.Name == "ABC" && naming.Finished, "native text uses game's OnTextInput validation and Finish");
        var valid = new GameTouch.Command(1, "ok", "menu/1", "tap");
        Check(GameTouch.Accept(valid, "ok") && !GameTouch.Accept(valid, "new"), "protocol epochs validated");
        Check(!GameTouch.Accept(valid with { x = float.NaN }, "ok") && !GameTouch.Accept(valid with { value = float.PositiveInfinity }, "ok"), "nonfinite commands rejected");
        Check(!GameTouch.Accept(valid with { text = new string('a', 1025) }, "ok") && !GameTouch.Accept(valid with { action = "delete" }, "ok"), "arbitrary actions and oversized text rejected");
        Check(GameTouch.Fresh(1000, 1200) && !GameTouch.Fresh(1000, 4000) && !GameTouch.Fresh(5000, 1000), "expired and future input cannot replay after suspend");
        Console.WriteLine($"PASS: {count} direct UI touch cases.");
    }
}

namespace Celeste {
    static class ActiveFont {
        public static int StringMeasurements;
        public static float LineHeight => 64;
        public static V Measure(char text) => throw new Exception("wrong font overload");
        public static V Measure(string text) { StringMeasurements++; return new(text.Length * 32, 64); }
    }
    static class Input { public static object MenuConfirm = new(), ESC = new(); }
    static class GFX { public static Atlas Gui = new(); }
    class Atlas {
        public Texture this[int index] => throw new Exception("wrong atlas overload");
        public Texture this[string name] => new() { Width = 164, Height = 164 };
    }
    readonly record struct V(float X, float Y);
    class TestOui : Monocle.Entity { public bool Focused = true; }
    partial class TextMenu {
        public V Position = new(960, 540), Justify = new(.5f, .5f);
        public float Width = 400, Height = 200, ItemSpacing = 10, Alpha = 1, RightColumnWidth = 150;
        public List<Item> Items = new();
        public int Selection;
        public Item? Current => Selection >= 0 && Selection < Items.Count ? Items[Selection] : null;
        public int FirstPossibleSelection => Items.FindIndex(i => i.Hoverable);
        public int LastPossibleSelection => Items.FindLastIndex(i => i.Hoverable);
        public void MoveSelection(int direction, bool wiggle) { Selection = Math.Clamp(Selection + direction, FirstPossibleSelection, LastPossibleSelection); }
        public class Item {
            public bool Visible = true, Disabled, Focused;
            public bool Hoverable => Visible && !Disabled;
            public string Label = "row";
            public Action? OnEnter, OnLeave, OnPressed;
            public int Confirmed;
            public float Height() => 64;
            public virtual void ConfirmPressed() => Confirmed++;
        }
        public class Option : Item {
            public int Index, Changes;
            public List<int> Values = new() { 0, 1, 2, 3, 4 };
            public void LeftPressed() { if (Index > 0) { Index--; Changes++; } }
            public void RightPressed() { if (Index < Values.Count - 1) { Index++; Changes++; } }
        }
    }
    class Texture { public float Width = 120, Height = 100; }
    class OuiMainMenu : TestOui { public List<MainMenuSmallButton> Buttons = new(); }
    class OuiFileSelect : TestOui {
        public List<OuiFileSelectSlot> Slots = new();
        public int SlotIndex = 0, SelectCalls; public bool SlotSelected;
        public void SelectSlot(bool reset) { SlotSelected = true; SelectCalls++; }
    }
    class OuiFileSelectSlot : Monocle.Entity {
        public V Position = new(960, 440);
        public Texture Card = new() { Width = 600, Height = 300 }, Ticket = new() { Width = 600 };
        public float highlightEase = 1, selectedEase;
        public int buttonIndex = 0;
        public List<Button> buttons = new();
        public class Button { public string Label = "继续"; public float Scale = 1; }
    }
    class MainMenuSmallButton : Monocle.Entity {
        public bool Selected;
        public MainMenuSmallButton? DownButton;
        public int Confirmed;
        public V Position = new(300, 400);
        public string label = "开始";
        public float labelScale = 1, ButtonHeight = 80;
        public void Confirm() => Confirmed++;
    }
    partial class OuiChapterPanel {
        public List<Option> options = new();
        public V OptionsRenderPosition = new(1000, 700);
        public int option = 0;
        public class Option {
            public Texture Bg = new(); public float Scale = 1;
            public V GetRenderPosition(V center) => center;
        }
    }
    partial class OuiChapterSelect {
        public float maplistEase, searchEase, journalEase;
        public bool journalEnabled;
        public List<Icon> icons = new();
        public class Icon : Monocle.Entity {
            public int Area; public bool hidden;
            public V Position = new(700, 800), Scale = new(1, 1);
        }
    }
    partial class OuiFileNaming {
        public string Name = "old";
        public V boxtopleft = new(400, 400), Position = new(0, 0);
        public float boxWidth = 800, boxHeight = 500, boxPadding = 24, widestLetter = 50, lineHeight = 64;
        public string[] letters = { "ABC" };
        public bool Finished;
        public void OnTextInput(char c) { if (c == '\b') Name = Name.Length > 0 ? Name[..^1] : ""; else if ("ABC".Contains(c)) Name += c; }
        private void Finish() => Finished = Name.Length > 0;
    }
}

namespace Celeste.Mod.Core {
    static class CoreModule { public static CoreSettings Settings = new(); }
    class CoreSettings { public Binding MenuSearch = new(); }
    class Binding { public object Button = new(); }
}
