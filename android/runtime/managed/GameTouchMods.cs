internal static partial class GameTouch
{
    private static void BuildMiaoChat(object chat) {
        var box = R(chat, "inputBox");
        var renderer = R(chat, "textRenderer");
        if (box == null || renderer == null || Method(box, "SetText", 1) == null) return;
        kind = "chat";
        float line = N(renderer, "LineHeight", 32);
        Add("text", box, new(16, hudHeight - 32 - line, hudWidth - 32, line + 16), "text", "MiaoNet 聊天（填入后点发送）", c => {
            // Deliberately do NOT SendChat/HandleCommand here. The separate Enter
            // button goes through the Mod's history, live-mode and command checks.
            if (c.action == "text" && B(chat, "Active")) {
                var value = new string(c.text.Where(ch => !char.IsControl(ch)).ToArray());
                int max = Math.Clamp((int)N(box, "MaxTextLength", 64), 1, 1024);
                if (value.Length > max) value = value[..max];
                if (value.Length > 0 && char.IsHighSurrogate(value[^1])) value = value[..^1];
                Call(box, "SetText", value);
            }
        }, S(box, "Text"), (int)N(box, "MaxTextLength", 64));
        var messages = R(chat, "chatMessageBox");
        if (messages == null) return;
        Add("chat/tabs", messages, new(16, hudHeight - 40 - 2 * line, hudWidth - 32, line), "swipe", "左右滑动切换聊天频道", c => {
            if (c.action != "swipe" || !B(chat, "Active")) return;
            Call(messages, c.value > 0 ? "CycleTabBackward" : "CycleTabForward");
            Call(chat, "SyncChatChannelWithTab");
        });
    }

    private static void BuildAssistSkip(object ui) {
        if (!B(ui, "opened") || N(ui, "openingEase") < .99f) return;
        kind = "menu";
        for (int i = 0; i < 2; i++) {
            int index = i;
            string key = "collabutils2_assist_skip_confirm_" + (i == 0 ? "yes" : "no");
            string label = Convert.ToString(Call(fontType?.Assembly.GetType("Celeste.Dialog"), "Clean", key, null)) ?? key;
            float width = Math.Max(240, Measure(label) * .8f);
            Add("collab/assist/" + i, ui, new(hudWidth / 2 - width / 2, hudHeight / 2 + 16 + i * LineHeight, width, LineHeight * .8f),
                "tap", label, c => {
                    if (c.action != "tap") return;
                    Set(ui, "currentlySelectedOption", index);
                    Press("MenuConfirm"); // The Mod still owns skip/cancel callbacks.
                });
        }
    }

    private static void BuildLobbyMap(object ui) {
        if (!B(ui, "focused") || B(ui, "closing")) return;
        var bounds = R(ui, "windowBounds");
        if (bounds == null) return;
        kind = "lobby_map";
        // The HUD and virtual navigation buttons remain available alongside this
        // surface. A drag pans only; it never confirms/teleports on release.
        Add("collab/map", ui, new(N(bounds, "X"), N(bounds, "Y"), N(bounds, "Width"), N(bounds, "Height")),
            "pan", "拖动大厅地图", c => {
                if (c.action != "pan" || B(ui, "shouldCentreOrigin") || N(ui, "translateTimeRemaining") > 0 ||
                    N(ui, "scaleTimeRemaining") > 0) return;
                float scale = N(ui, "finalScale"), width = N(R(ui, "mapTexture"), "Width") * scale,
                    height = N(R(ui, "mapTexture"), "Height") * scale;
                if (width <= 0 || height <= 0 || Math.Abs(c.x) > 1 || Math.Abs(c.y) > 1) return;
                var origin = R(ui, "actualOrigin");
                if (origin == null) return;
                Set(origin, "X", Math.Clamp(N(origin, "X") - c.x * hudWidth / width, 0, 1));
                Set(origin, "Y", Math.Clamp(N(origin, "Y") - c.y * hudHeight / height, 0, 1));
                Set(ui, "actualOrigin", origin);
                // Match the Mod's pan selection, using only its already-unlocked warps.
                var warps = List(R(ui, "activeWarps"));
                var indexes = R(ui, "selectedWarpIndexes") as int[];
                int lobby = (int)N(ui, "selectedLobbyIndex", -1);
                if (!B(ui, "viewOnly") && warps.Count > 0 && indexes != null && lobby >= 0 && lobby < indexes.Length &&
                    Call(ui, "nearestWarpIndexToActualOrigin") is int index && index >= 0 && index < warps.Count) {
                    indexes[lobby] = index;
                    Set(ui, "lastSelectedWarpIndex", index);
                    var selected = Call(ui, "originForPosition", R(warps[index], "Position"));
                    if (selected != null) Set(ui, "selectedOrigin", selected);
                }
                Call(ui, "updateMarkers");
            });
    }
}
