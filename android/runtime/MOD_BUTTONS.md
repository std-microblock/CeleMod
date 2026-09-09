# Custom Mod virtual buttons (Android)

The Android **按键** page manages touch buttons instead of recording physical
keyboard/controller input. Create a name, choose text or a built-in icon, select
1–16 actions and save. Up to 24 buttons are supported, with rename, enable/disable,
delete confirmation, search and Mod filtering. Icon previews use the same shapes
as the Android Canvas renderer; legacy definitions without an icon remain text.

Definitions live in `celemod-touch-buttons.json` at the game root, written by
`save_touch_buttons` using atomic replacement. They are read on the next game
launch. No game/Mod key configuration, DLL or save is rewritten. Missing or
disabled Mods keep their saved references. Start newly installed Mods once to
generate their settings, then refresh the catalog. Standard Everest
`ButtonBinding` settings (including nested objects/lists/dictionaries) and the
listed vanilla button actions are supported. Legacy keyboard-chord settings and
direction axes are explicitly marked unsupported rather than pretending to work.

`GameModButtons` resolves each reference to the actual loaded module's
`_Settings` / `Button` object. Typed runtime-only MonoMod hooks compose physical
input with virtual `Check`, `Pressed`, `Released` and consumption. A single
button may own several actions; several buttons may share an action. The last
owner releases it. Buttons with no resolved actions are hidden during play but
remain editable in the layout preview. Partially available groups still activate
their available actions. Live object replacement invalidates all old holds.

The native overlay displays enabled custom buttons even when default gameplay
touch controls are disabled. They appear in game and menus, except loading,
transitions and text-entry scenes. Game/menu positions are separate, and use the
existing per-orientation position/size/slide/opacity/vibration draft editor.
Fixed toolbar controls remain protected. Save/cancel/reset semantics are unchanged.

Negative input tokens are private virtual-button IDs, **never SDL keycodes**.
`ModButtonWriter` publishes a bounded atomic transition journal separately from
direct UI touch. The game consumes at most one fresh state per frame, preserving
fast down/up pairs. Held states receive a 250ms heartbeat and expire after one
second without renewal. Epochs reject input from old scenes, UI modes or binding
objects. Focus loss, cancellation, editor entry, resize and teardown clear holds.
Input-disabled states and text-entry scenes suppress virtual input. Hook failures
leave the existing SDL/direct-touch paths intact.

## Verification

- Managed controls executable includes configuration/icon compatibility, escaped
  nested paths, multi-action/shared ownership, fast taps, timeout, consumption,
  physical-input composition and scene/pause guards.
- Android JUnit tests cover private token resolution, unavailable actions,
  visibility and custom position/style draft persistence.
- Rust tests cover schema round-trip, limits, duplicate/invalid/unsupported
  references and compatibility with definitions without an icon.
- UI unit tests and `tests/android-keybindings/` fixture cover multi-selection,
  physical-unbound actions, icons, validation, saved missing Mods and failed saves.

Device checks: save a text and an icon button, bind multiple functions, launch,
tap/hold/slide with another finger, release or background, edit positions/styles,
cancel/save, and relaunch. Verify real Mod actions activate without changing their
physical key bindings. Unsupported Mod-specific raw keyboard polling is not
silently mapped onto someone else's key.

Verified on 2026-09-09: UI fixture at 360×800 and 800×400 (multi-action save,
refresh/edit, icon persistence, unavailable references, save-error recovery,
no horizontal overflow). On an arm64 Android device, an icon button directly
opened Everest's DebugConsole and native keyboard; custom icons, drag placement,
style dialog and editor cancellation were checked. The device smoke test used
Everest + MiaoNet + ChineseFontPack, not the full installed Mod pack. Temporary
button definitions were removed and the original Mod blacklist restored.
The final APK's manager also passed real-device icon selection, semantic action
selection, save-to-file, refresh and edit-refill checks. The isolated staged
managed sources and 66 Kotlin/JUnit cases passed without unrelated local edits.
