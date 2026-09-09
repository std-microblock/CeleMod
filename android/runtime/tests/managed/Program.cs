// Synthetic game objects: tests need neither proprietary game data nor Harmony.
using Celeste;

int count = 0;
void Mode(object? scene, string expected) {
    var actual = GameControls.Classify(scene);
    if (actual != expected) throw new Exception($"Expected {expected}, got {actual} ({scene?.GetType()})");
    count++;
}
Mode(null, "loading");
Mode(new GameLoader(), "loading");
Mode(new LevelLoader(), "loading");
Mode(new OverworldLoader(), "loading");
Mode(new Level(), "gameplay");
Mode(new CustomLevel(), "gameplay");
Mode(new Level { Paused = true, PauseMainMenuOpen = true }, "pause");
Mode(new Level { Paused = true }, "pause_menu");
Mode(new Level { Overlay = new object() }, "menu");
Mode(new Level { InCutscene = true }, "gameplay");
Mode(new Level { Entities = { new Textbox { Opened = true } } }, "dialogue");
Mode(new Level { Entities = { new Textbox { Opened = true, Visible = false } } }, "gameplay");
Mode(new Level { Entities = { new Textbox { Opened = false } } }, "gameplay");
Mode(new Level { Entities = { new TextMenu { Focused = false } } }, "gameplay");
Mode(new Level { Entities = { new TextMenu { Focused = true, Active = false } } }, "gameplay");
Mode(new Level { Entities = { new Textbox { Opened = true }, new CustomMenu { Focused = true } } }, "menu");
Mode(new Level { Paused = true, PauseMainMenuOpen = true, Entities = { new Textbox { Opened = true } } }, "pause");
Mode(new Overworld { Current = new OuiTitleScreen() }, "title");
Mode(new Overworld { Current = new OuiChapterSelect() }, "chapter");
Mode(new Overworld { Current = new OuiChapterPanel() }, "chapter");
Mode(new Overworld { Current = new OuiJournal() }, "journal");
Mode(new Overworld { Current = new OuiFileNaming() }, "naming");
Mode(new Overworld { Current = new Celeste.Mod.UI.OuiModOptionString() }, "naming");
Mode(new Overworld { Current = new Celeste.Mod.UI.OuiNumberEntry() }, "naming");
Mode(new Overworld { Current = new Celeste.Mod.UI.OuiMapSearch() }, "search");
Mode(new Overworld { Current = new CustomMenu() }, "menu");
Mode(new Overworld { Current = new OuiChapterSelect(), Overlay = new object() }, "menu");
Mode(new Overworld { Next = new OuiJournal() }, "transition");
Mode(new Overworld { Current = new OuiTitleScreen(), transitioning = true }, "transition");
Mode(new Overworld { Current = new OuiChapterPanel(), transitioning = true }, "transition");
Mode(new Overworld { Last = new OuiTitleScreen() }, "title");
Mode(new Celeste.Pico8.Emulator(), "pico8");
Mode(new AreaComplete(), "complete");
Mode(new LevelEnter(), "complete");
Mode(new LevelExit(), "complete");
Mode(new Credits(), "complete");
Mode(new object(), "fallback");
Console.WriteLine($"PASS: {count} managed scene classification cases.");
BindingTests.Run();
ModButtonTests.Run();
GameHookTests.Run();
DirectTouchTests.Run();

class CustomLevel : Level { }
class CustomMenu : TextMenu { }
namespace Monocle {
    class Scene { public bool Paused; }
    class Entity { public bool Active = true; public bool Visible = true; }
}
namespace Celeste {
    class Level : Monocle.Scene {
        public bool PauseMainMenuOpen;
        public bool InCutscene;
        public object? Overlay { get; set; }
        public List<Monocle.Entity> Entities { get; set; } = new();
    }
    class Overworld { public object? Current; public object? Next; public object? Last; public object? Overlay; public bool transitioning; public List<Monocle.Entity> Entities = new(); }
    class Textbox : Monocle.Entity { public bool Opened { get; set; } }
    partial class TextMenu : Monocle.Entity { public bool Focused; }
    class OuiTitleScreen : Monocle.Entity { public bool hideConfirmButton; }
    partial class OuiChapterSelect : TestOui { }
    partial class OuiChapterPanel : TestOui { }
    class OuiJournal : TestOui { }
    partial class OuiFileNaming : TestOui { }
    class GameLoader { }
    class LevelLoader { }
    class OverworldLoader { }
    class AreaComplete { }
    class LevelEnter { }
    class LevelExit { }
    class Credits { }
}
namespace Celeste.Mod.UI { class OuiModOptionString { } class OuiNumberEntry { } class OuiMapSearch { } }
namespace Celeste.Pico8 { class Emulator { } }
