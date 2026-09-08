using System.Collections;

internal static partial class GameTouch
{
    private static void SelectItem(object menu, object item, int index) {
        if ((int)N(menu, "Selection", -1) == index) return;
        Callback(R(menu, "Current"), "OnLeave");
        Set(menu, "Selection", index);
        Callback(item, "OnEnter");
    }

    private static void BuildMenu(object menu, string prefix = "menu") {
        if (!B(menu, "Visible") || N(menu, "Alpha", 1) < .95f) return;
        var items = List(R(menu, "Items") ?? R(menu, "items"));
        // Expanded custom submenus own a different layout; don't guess their child coordinates.
        if (items.Any(i => B(i, "Focused"))) return;
        float width = N(menu, "Width"), height = N(menu, "Height");
        if (width <= 0 || height <= 0) return;
        float left = X(menu) - N(R(menu, "Justify"), "X") * width;
        float top = Y(menu) - N(R(menu, "Justify"), "Y") * height;
        float offset = 0, spacing = N(menu, "ItemSpacing");
        kind = "menu";
        for (int i = 0; i < items.Count; i++) {
            var item = items[i];
            if (!B(item, "Visible")) continue;
            float h = Convert.ToSingle(Call(item, "Height") ?? 0);
            float y = top + offset + N(R(item, "SelectWiggler"), "Value") * 8;
            offset += h + spacing;
            if (!B(item, "Hoverable") || h <= 0) continue;
            int index = i;
            var values = List(R(item, "Values"));
            bool slider = values.Count > 1 && R(item, "Index") is int;
            Add(prefix + "/" + i, item, new(left, y, width, h), slider ? "slider" : "tap", S(item, "Label"), c => {
                if (c.action == "scroll") { ScrollMenu(menu, c.value); return; }
                SelectItem(menu, item, index);
                if (!B(menu, "Focused") || !ReferenceEquals(R(menu, "Current"), item)) return;
                if (slider && c.action is "tap" or "adjust") {
                    float rightWidth = Math.Max(1, N(menu, "RightColumnWidth", width / 2));
                    float start = left + width - rightWidth;
                    if (c.action == "tap") {
                        // Tap either arrow half; tap the label cycles to the next value.
                        if (c.x * hudWidth < start && values.Count == 2) Call(item, "ConfirmPressed");
                        else Call(item, c.x * hudWidth >= start && c.x * hudWidth < start + rightWidth / 2 ? "LeftPressed" : "RightPressed");
                    } else {
                        int desired = (int)MathF.Round(Math.Clamp((c.x * hudWidth - start) / rightWidth, 0, 1) * (values.Count - 1));
                        for (int step = 0; step < Math.Min(values.Count, 128); step++) {
                            int before = (int)N(item, "Index");
                            if (before == desired) break;
                            Call(item, before < desired ? "RightPressed" : "LeftPressed");
                            if ((int)N(item, "Index") == before || !B(menu, "Focused")) break;
                        }
                    }
                } else if (c.action == "tap") {
                    // Use exactly the same hooks as TextMenu.Update (including mod callbacks).
                    Call(item, "ConfirmPressed");
                    if (ReferenceEquals(R(menu, "Current"), item)) Callback(item, "OnPressed");
                }
            });
        }
        // Blank space also scrolls long menus without activating the release row.
        Add(prefix + "/scroll", menu, new(left, 0, width, hudHeight), "scroll", "滑动列表", c => {
            if (c.action == "scroll") ScrollMenu(menu, c.value);
        });
        // Background target must be below rows in hit order.
        var background = targets[^1]; targets.RemoveAt(targets.Count - 1); targets.Insert(0, background);
    }
    private static void ScrollMenu(object menu, float amount) {
        int direction = Math.Sign(amount);
        int steps = Math.Clamp((int)Math.Abs(amount), 0, 12);
        for (int i = 0; i < steps; i++) {
            int selected = (int)N(menu, "Selection", -1);
            int end = (int)N(menu, direction > 0 ? "LastPossibleSelection" : "FirstPossibleSelection", selected);
            if (selected == end || !B(menu, "Focused")) break;
            Call(menu, "MoveSelection", direction, false);
        }
    }

    private static void BuildMain(object ui) {
        var buttons = List(R(ui, "Buttons") ?? R(ui, "buttons"));
        if (buttons.Count == 0) return;
        kind = "main";
        Add("main/scroll", ui, new(0, 0, hudWidth, hudHeight), "scroll", "滑动选择", c => ScrollMain(buttons, c));
        foreach (var button in buttons) {
            // OuiMainMenu.Render calls button.Render itself, checking Scene,
            // not the child Entity.Visible flag used by the normal renderer.
            if (!B(button, "Active") || !ReferenceEquals(R(button, "Scene"), R(ui, "Scene"))) continue;
            float height = N(button, "ButtonHeight"), x = X(button), y = Y(button);
            var label = S(button, "label");
            float labelWidth = Measure(label) * N(button, "labelScale", 1);
            bool climb = Is(button, "MainMenuClimb");
            float width = climb ? Math.Max(N(R(button, "icon"), "Width"), labelWidth * 1.5f) : labelWidth + 116;
            Add("main/" + Identity(button), button, new(x - (climb ? width / 2 : 0), y, width, height), "tap", label, c => {
                if (c.action != "tap") { ScrollMain(buttons, c); return; }
                Set(button, "Selected", true);
                Call(button, "Confirm");
            });
        }
    }
    private static void ScrollMain(List<object> buttons, Command c) {
        if (c.action is not ("scroll" or "swipe" or "swipeY")) return;
        var selected = buttons.FirstOrDefault(b => B(b, "Selected"));
        if (selected == null) return;
        string neighbor = c.action == "swipe" ? (c.value > 0 ? "RightButton" : "LeftButton") : (c.value > 0 ? "DownButton" : "UpButton");
        int count = c.action == "scroll" ? Math.Clamp((int)Math.Abs(c.value), 1, 12) : 1;
        for (int i = 0; i < count; i++) {
            var next = R(selected, neighbor);
            if (next == null || !buttons.Contains(next) || !B(next, "Active")) break;
            Set(next, "Selected", true); selected = next;
        }
    }

    private static void BuildFiles(object ui) {
        var slots = List(R(ui, "Slots"));
        if (slots.Count == 0) return;
        kind = "cards";
        if (!B(ui, "SlotSelected")) {
            for (int i = 0; i < slots.Count; i++) {
                var slot = slots[i]; int index = i;
                if (!B(slot, "Visible") || !B(slot, "Active") || R(slot, "tween") != null) continue;
                float height = N(R(slot, "Card"), "Height", 300);
                float spread = Ease(N(slot, "highlightEase")) * 360;
                float left = X(slot) - spread - N(R(slot, "Card"), "Width", 600) / 2;
                float right = X(slot) + spread + N(R(slot, "Ticket"), "Width", 600) / 2;
                Add("file/" + i, slot, new(left, Y(slot) - height / 2, right - left, height), "tap", S(slot, "Name"), c => {
                    if (c.action == "tap") { Set(ui, "SlotIndex", index); Call(ui, "SelectSlot", true); }
                    else if (c.action == "swipe") Press(c.value > 0 ? "MenuDown" : "MenuUp");
                });
            }
            Add("files/swipe", ui, new(0, 0, hudWidth, hudHeight), "swipe", "滑动选择存档", c => {
                if (c.action == "swipe") Press(c.value > 0 ? "MenuDown" : "MenuUp");
            });
            var background = targets[^1]; targets.RemoveAt(targets.Count - 1); targets.Insert(0, background);
            return;
        }
        int selected = (int)N(ui, "SlotIndex");
        if (selected < 0 || selected >= slots.Count) { kind = ""; return; }
        var active = slots[selected]; root = active;
        if (!B(active, "Visible") || !B(active, "Active") || R(active, "tween") != null || N(active, "inputDelay") > 0 || B(active, "StartingGame")) return;
        if (B(active, "deleting")) {
            // Existing game confirmation is preserved, never call TryDelete directly.
            if (N(active, "deletingEase") < .99f) return;
            for (int i = 0; i < 2; i++) {
                int index = i;
                string text = Convert.ToString(Call(active.GetType().Assembly.GetType("Celeste.Dialog"), "Clean",
                    i == 0 ? "file_delete_yes" : "file_delete_no", null)) ?? "";
                float width = Math.Max(Measure(text) * .8f, 240);
                Add("delete/" + i, active, new(hudWidth / 2 - width / 2, hudHeight / 2 + 16 + i * LineHeight, width, LineHeight * .8f),
                    "tap", text, c => { if (c.action == "tap") { Set(active, "deleteIndex", index); Press("MenuConfirm"); } });
            }
            return;
        }
        float y = Y(active) - 150 + 350 * N(active, "selectedEase");
        var buttons = List(R(active, "buttons"));
        for (int i = 0; i < buttons.Count; i++) {
            int index = i; var button = buttons[i];
            float scale = N(button, "Scale", 1), h = LineHeight * scale, w = Measure(S(button, "Label")) * scale;
            Add("file/action/" + i, button, new(X(active) - w / 2, y, w, h), "tap", S(button, "Label"), c => {
                if (c.action == "tap") { Set(active, "buttonIndex", index); Press("MenuConfirm"); }
            });
            y += h + 15;
        }
    }

    private static void BuildChapters(object ui) {
        if (B(ui, "disableInput")) return;
        var icons = List(R(ui, "icons"));
        kind = "chapters";
        Add("chapters/swipe", ui, new(0, 0, hudWidth, hudHeight), "swipe", "左右滑动切换章节", c => {
            if (c.action == "swipe") Press(c.value > 0 ? "MenuRight" : "MenuLeft");
            else if (c.action == "swipeY") Press(c.value > 0 ? "MenuDown" : "MenuUp");
        });
        foreach (var icon in icons) {
            if (!B(icon, "Visible") || B(icon, "hidden") || B(icon, "HideIcon") || N(icon, "Area", -1) < 0) continue;
            float size = 100 + 44 * Ease(N(icon, "sizeEase"));
            float sx = Math.Abs(N(R(icon, "Scale"), "X", 1)), sy = Math.Abs(N(R(icon, "Scale"), "Y", 1));
            float w = size * sx, h = size * sy;
            int area = (int)N(icon, "Area");
            Add("chapter/" + area, icon, new(X(icon) - w / 2, Y(icon) - h / 2, w, h), "tap", "章节", c => {
                if (c.action == "swipe") { Press(c.value > 0 ? "MenuRight" : "MenuLeft"); return; }
                if (c.action == "swipeY") { Press(c.value > 0 ? "MenuDown" : "MenuUp"); return; }
                if (c.action != "tap" || N(ui, "inputDelay") > 0) return;
                // Hidden/locked chapters have no targets. Selecting retains the game's unlock confirmation.
                Set(ui, "area", area);
                Call(icon, "Hovered", 1);
                if (!B(icon, "AssistModeUnlockable")) Call(ui, "EaseCamera");
                Press("MenuConfirm");
            });
        }
        // Everest's map-list/search and the vanilla journal icons use the same
        // semantic inputs as their keyboard/controller shortcuts.
        void Shortcut(string id, string texture, string binding, string easeMember, float y) {
            float ease = N(ui, easeMember);
            if (ease < .99f) return;
            var atlas = R(ui.GetType().Assembly.GetType("Celeste.GFX"), "Gui");
            var image = Call(atlas, "get_Item", texture);
            float w = N(image, "Width"), h = N(image, "Height");
            float x = 128 * (1 - MathF.Pow(1 - ease, 3));
            // The 164px artwork is spaced only 128px apart. Partition at the
            // midpoints so the upper shortcut cannot steal the lower one's taps.
            h = Math.Min(h, 128);
            Add(id, ui, new(x - w / 2, y - h / 2, w, h), "tap", id, c => {
                if (c.action == "tap") Press(binding);
                else if (c.action == "swipe") Press(c.value > 0 ? "MenuRight" : "MenuLeft");
                else if (c.action == "swipeY") Press(c.value > 0 ? "MenuDown" : "MenuUp");
            });
        }
        bool journal = B(ui, "journalEnabled");
        if (journal) Shortcut("journal", "menu/journal", "MenuJournal", "journalEase", hudHeight - 128);
        Shortcut("map-list", "menu/maplist", "ESC", "maplistEase", hudHeight - 128 - (journal ? 128 : 0));
        Shortcut("map-search", "menu/mapsearch", "MenuSearch", "searchEase", hudHeight - 128 - (journal ? 256 : 128));
    }
    private static float Ease(float value) => value < .5f ? 4 * value * value * value : 1 - MathF.Pow(-2 * value + 2, 3) / 2;

    private static void BuildPanel(object ui) {
        if (B(ui, "EnteringChapter")) return;
        var options = List(R(ui, "options"));
        var center = R(ui, "OptionsRenderPosition");
        if (center == null || options.Count == 0) return;
        kind = "chapters";
        Add("panel/swipe", ui, new(0, 0, hudWidth, hudHeight), "swipe", "左右滑动切换", c => {
            if (c.action == "swipe") Press(c.value > 0 ? "MenuRight" : "MenuLeft");
        });
        for (int i = 0; i < options.Count; i++) {
            int index = i; var option = options[i];
            var position = Call(option, "GetRenderPosition", center);
            float scale = N(option, "Scale", 1), w = N(R(option, "Bg"), "Width") * scale, h = N(R(option, "Bg"), "Height") * scale;
            Add("panel/" + i, option, new(N(position, "X") - w / 2, N(position, "Y") + 10 - h / 2, w, h), "tap", S(option, "Label"), c => {
                if (c.action == "swipe") { Press(c.value > 0 ? "MenuRight" : "MenuLeft"); return; }
                if (c.action == "tap") { Set(ui, "option", index); Press("MenuConfirm"); }
            });
        }
    }

    private static void BuildNaming(object ui) {
        var box = R(ui, "boxtopleft") ?? R(ui, "boxTopLeft");
        if (box == null) return;
        bool number = Is(ui, "Mod.UI.OuiNumberEntry");
        string member = Is(ui, "OuiFileNaming") ? "Name" : "Value";
        bool textInput = Method(ui, "OnTextInput", 1) != null;
        kind = "text";
        float textWidth = Math.Max(240, Measure(S(ui, member)) * 2 + 48);
        var textBox = new Box(X(ui) + hudWidth / 2 - textWidth / 2, Y(ui) + (number ? 286 : 256) - LineHeight,
            textWidth, LineHeight * 2 + 16);
        if (Is(ui, "OuiFileNaming") && R(ui, "FileSlot") is object slot) {
            // File names are drawn by the selected card, not OuiFileNaming.Render.
            float cardX = X(slot) - Ease(N(slot, "highlightEase")) * 360;
            float cardWidth = N(R(slot, "Card"), "Width");
            float nameArea = cardWidth - 2 * 64 - 200 - 16;
            float nameX = cardX - cardWidth / 2 + 64 + 200 + 16 + nameArea / 2;
            float nameY = Y(slot) - 32 + (B(slot, "Exists") ? 0 : 64);
            float width = Math.Max(240, Math.Min(440, Measure(S(ui, member))) + 32);
            textBox = new(nameX - width / 2, nameY - LineHeight - 8, width, LineHeight + 24);
        }
        Add("text", ui, textBox,
            number ? "number" : "text", "编辑文本", c => {
                if (c.action != "text") return;
                if (textInput) ReplaceText(ui, member, c.text);
                else {
                    // Vanilla has no OnTextInput: retain its alphabet and length restrictions.
                    var alphabet = string.Concat(List(R(ui, "letters")));
                    var value = new string(c.text.Where(ch => ch == ' ' || alphabet.Contains(ch)).ToArray());
                    Set(ui, member, value.Trim().Substring(0, Math.Min(value.Trim().Length, (int)N(ui, "MaxNameLength", 12))));
                }
                Call(ui, "Finish");
            }, S(ui, member), (int)N(ui, "MaxValueLength", N(ui, "MaxNameLength", 12)) + (number ? 2 : 0));
        // The existing visible alphabet stays directly tappable too.
        var letters = List(R(ui, "letters"));
        var keyboard = R(ui, "keyboardTopLeft") ?? box;
        float pad = N(ui, "boxPadding"), cw = N(ui, "widestLetter"), ch = N(ui, "lineHeight"), spacing = N(ui, "lineSpacing");
        for (int row = 0; row < letters.Count; row++) {
            var line = letters[row].ToString() ?? "";
            for (int col = 0; col < line.Length; col++) {
                int r = row, c = col; char letter = line[col];
                if (letter == ' ' || number && (letter == '-' && !B(ui, "allowNegatives") || letter == '.' && !B(ui, "allowDecimals"))) continue;
                Add("letter/" + row + "/" + col, ui, new(N(keyboard, "X") + pad + col * cw, N(keyboard, "Y") + pad + row * (ch + spacing * (number ? 1.4f : 1)), cw, ch),
                    "tap", letter.ToString(), cmd => {
                        if (cmd.action != "tap") return;
                        if (textInput) Call(ui, "OnTextInput", letter);
                        else { Set(ui, "line", r); Set(ui, "index", c); Set(ui, "selectingOptions", false); Press("MenuConfirm"); }
                    });
            }
        }
        float oy = N(box, "Y") + N(ui, "boxHeight") - ch - pad;
        float os = N(ui, "optionsScale", 1), bx = N(box, "X"), bw = N(ui, "boxWidth");
        var opts = number ? new[] { "cancel", "backspace", "accept" } : new[] { "cancel", "space", "backspace", "accept" };
        for (int i = 0; i < opts.Length; i++) {
            int index = i; string name = opts[i], text = S(ui, name);
            float w = Measure(text) * os * (name == "accept" && !number ? 1.25f : 1);
            float x = bx + pad;
            if (i > 0) {
                float trailing = opts.Skip(i).Sum(n => N(ui, n == "accept" ? (number ? "acceptWidth" : "beginWidth") : n + "Width"));
                x = bx + bw - pad - trailing - (opts.Length - i - 1) * cw;
            }
            if (number) x += name == "accept" ? 10 - cw : (i == 0 ? 15 : 15 - cw);
            Add("text/" + name, ui, new(x, oy, w, ch), "tap", text, cmd => {
                if (cmd.action != "tap") return;
                if (name == "cancel") Call(ui, "Cancel");
                else if (name == "accept") Call(ui, "Finish");
                else if (textInput) Call(ui, "OnTextInput", name == "space" ? ' ' : '\b');
                else { Set(ui, "selectingOptions", true); Set(ui, "optionsIndex", index); Press("MenuConfirm"); }
            });
        }
    }
    private static void ReplaceText(object ui, string member, string value) {
        int length = Math.Min(S(ui, member).Length, 1024);
        for (int i = 0; i < length; i++) Call(ui, "OnTextInput", '\b');
        foreach (char ch in value.Where(c => !char.IsControl(c)).Take(1024)) Call(ui, "OnTextInput", ch);
    }

    private static void BuildSearch(object ui) {
        var menu = R(ui, "menu"); var left = R(menu, "leftMenu"); var right = R(menu, "rightMenu");
        var title = R(ui, "searchTitle");
        if (menu == null || left == null || right == null || title == null) return;
        if (B(left, "Focused")) BuildMenu(left, "search/left");
        if (B(right, "Focused")) BuildMenu(right, "search/right");
        kind = "search";
        float y = Y(left) + N(left, "Height") * N(R(left, "Justify"), "Y") +
            Convert.ToSingle(Call(left, "GetYOffsetOf", title) ?? 0) + 1;
        float x = X(left) + N(left, "Width") * N(R(left, "Justify"), "X") - 208;
        Add("text", ui, new(x, y - LineHeight / 2, 416, LineHeight), "text", "搜索地图", c => {
            if (c.action != "text") return;
            Set(ui, "Searching", true);
            ReplaceText(ui, "search", c.text);
            // Rebuild before switching focus; the game's switchMenu also owns MInput.Disabled.
            Call(ui, "ReloadItems");
            Set(ui, "searchPrev", S(ui, "search"));
            if (B(menu, "leftFocused")) Call(ui, "switchMenu");
        }, S(ui, "search"), 128);
    }
}
