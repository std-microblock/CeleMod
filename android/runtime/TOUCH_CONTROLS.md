# Android contextual touch controls

`GameControls.cs` samples **actual game state on the Engine.Update thread**, at most
once every 50 ms. A single background writer atomically replaces the versioned
`cache/game-controls-<pid>.json` snapshot only when it changes. Android reads on a
worker thread and applies layouts on the UI thread. No screenshot recognition,
pause-key toggles, proprietary game references, or persistent game setting changes.

## Profiles

| Context | Left | Bottom right / other actions | Top right |
| --- | --- | --- | --- |
| Gameplay | Preferred eight-way stick or D-pad | Jump, dash, grab; interaction appears in Talk range | Pause icon / Esc |
| Pause main menu | Cardinal D-pad | Confirm, cancel | **Play/resume icon / Esc** |
| Pause submenus / confirmation prompts | Cardinal D-pad | Confirm, cancel | Back icon / Esc |
| Main menu, saves, options, Everest / mod Oui menus | Cardinal D-pad | Confirm, cancel | Bound menu-cancel key |
| Title | Hidden | Start | Esc |
| Chapter select / chapter panel | Cardinal D-pad | Confirm, cancel; journal shortcut | Cancel |
| Journal | Cardinal D-pad (including mod page navigation) | Close | Cancel |
| Naming / mod string or number entry | Cardinal D-pad | Character, delete, finish | Esc |
| Keyboard-based naming | Cardinal D-pad | Enter, backspace; native keyboard shortcut | Esc |
| Everest map search | Cardinal D-pad | Search/delete and native keyboard while text entry is active; otherwise confirm/cancel | Esc |
| Open dialogue | Hidden | Continue | Pause (the game handles its skip-cutscene menu) |
| Chapter-entry postcards / completion / credits | Hidden | Continue | Esc |
| PICO-8 | Preferred stick or D-pad | Jump, dash | Esc |
| Loading | Hidden | Hidden | Hidden |
| Unknown mod scene / unavailable hook | Preferred stick or D-pad | Gameplay actions plus confirm/cancel | Esc |

Non-dialogue cutscenes, room transitions and death/respawn deliberately keep
gameplay controls: hiding them based solely on `InCutscene`, `Frozen`, or a player
state number breaks controllable sequences and mods. Focused in-level `TextMenu`
subclasses take precedence over dialogue. Pause submenus are not mislabeled as
one-tap resume.

## Input and lifecycle rules

- Android Back (key or predictive-back gesture) injects a single Esc pulse after
  startup. If the native text keyboard is open, Back dismisses it first. During
  startup it retains the cancel-launch confirmation.
- The top-left edit button and adjacent exit icon are fixed. Exit **always asks for confirmation** and is
  available even when both touch options are off. It does not save the game for you.
- Enabling only the stick still provides complete menu navigation and confirmation.
  Disabling both options leaves only edit/exit; other touches pass through.
- Bindings are read from `Celeste.Input` and `Settings`, including menu directions,
  gameplay movement and interaction. Supported keyboard bindings use their first
  Android-representable key. Empty/controller-only/unsupported bindings fall back
  to vanilla keyboard defaults; no game bindings are overwritten.
- A profile, UI, binding, focus, size or lifecycle change releases owned keys and
  cancels pending pulses. Changes to Talk availability do not interrupt held climb.
- Gameplay supports independent multi-touch action holds and eight directions.
  Menu D-pad input is cardinal, slides between keys and releases outside the pad.
  Short taps are held briefly so SDL keydown/up cannot vanish between FNA frames.
- Native shapes draw all navigation/pause/resume/confirm icons, independent of
  installed fonts. Display cutouts and system bars are excluded from placement.

## Position editor

- Tap the permanent **编辑** pencil at the top left. Drag any outlined button or
  the stick; these editor touches never inject game keys. Known gameplay receives
  one pause request first; leaving the editor does not automatically resume play.
- **到菜单 / 到游戏** previews both layouts without navigating the game. Game
  actions/stick and menu actions/D-pad have separate positions; pause/resume and
  auxiliary icons use shared positions. Menu primary/secondary positions remain
  consistent when confirm changes to continue, character entry, or close.
- **保存** applies and persists both previews. **取消** or Android Back discards
  edits. **重置** asks for confirmation and resets the current orientation's draft;
  it is not permanent until Save, and Cancel can still undo it.
- Positions are stored as normalized safe-viewport centers in private Android
  preferences, independently for landscape and portrait. They survive game and
  app restarts, scale to screen-size/inset changes, and are clamped so buttons and
  the stick stay visible. Custom controls cannot cover the fixed toolbar.
- Editor controls are available even with touch gameplay disabled; previewing and
  saving do not change the user's touch-enable settings. The editor shows the
  selected gameplay direction style (stick or D-pad).
- Incoming scene changes do not replace the editor preview. The latest real
  scene is applied after Save/Cancel. A screen-orientation change cancels an
  unsaved draft with a message; ordinary resizing retains normalized positions.
- Layout tests cover round-trip persistence, corrupt input, cancel/reset isolation,
  drag cancellation, geometry scaling, screen edges, and toolbar protection.

## Direct UI touch

Supported menus default to direct touch when either touch preference is enabled.
The fixed **按键 / 触屏** switch beside Edit/Exit can restore the virtual D-pad and
actions at any time; that choice persists. The position editor always previews the
virtual controls, independently of this switch. Gameplay keeps its original controls.

| UI | Direct interaction |
| --- | --- |
| Title / main menu | Tap to start; tap actual buttons; swipe to move selection using the menu's own neighbor links (including Everest row layouts) |
| Pause / options / ordinary mod TextMenus | Tap a visible enabled row; drag option values horizontally; slide vertically to scroll selection without confirming |
| Save slots | Tap a card and its actions; swipe to change selection; delete still opens the game's own confirmation |
| Chapters | Tap visible unlocked/assist-unlockable icons; swipe left/right for chapters, up/down for Everest level sets; tap journal/map-list/search shortcuts |
| Chapter panel | Tap actual mode/checkpoint tabs; swipe left/right between choices |
| Journal | Swipe left/right to turn pages; vertical swipes are passed to page navigation; retain Back |
| Dialogue / postcards / completion / credits | Short tap sends one semantic confirm; drags/long holds never confirm; no direct skip-cutscene calls |
| File naming / Everest string and number entry | Tap the displayed name/value for a native text editor; alphabet and finish/backspace/back options also accept taps |
| Everest map search | Tap the actual search field for native keyboard entry, then tap results or slide the result list |

Architecture: the CeleMod startup hook installs **runtime-only Harmony hooks** in
Engine.Update and VirtualButton.Pressed/consumption. It does not rewrite Celeste or
Everest DLLs on disk. Game-side adapters read live objects, positions, texture/font
sizes, menu spacing, and the actual Engine viewport/backbuffer; Android maps into
that viewport, excluding letterboxing. HUD-relative constants used by specific
vanilla/Everest widgets are not hardcoded Android screen coordinates. Mod render
overrides with a different layout are best-effort and can use the explicit fallback.

Reflection and callbacks only run on the game thread. The Android writer publishes
a bounded, atomic command journal off the UI thread; the game reads it in the
background and processes commands in Engine.Update. Commands carry a session/UI
epoch and sequence, expire after 1.5 seconds, and are checked against fresh targets.
Changing scenes, modal dialogs, item identity, or availability invalidates old
gestures. Geometry movement alone does not invalidate a scrolling gesture. Disabled,
hidden, inactive or ambiguous menus never expose underlying actions. Expanded
custom submenus and unknown overlays retain virtual navigation instead of guessed
child targets.

Swipes respond when the drag threshold is crossed rather than waiting for release;
page changes occur at most once per finger gesture. Continuous menu scrolling uses
shorter steps. Input is single-finger: adding another finger cancels the gesture.
The game keeps its own selection animation; no flashing rectangular overlay is drawn.
Native text is a draft until the dialog is accepted; Cancel/Back makes no game change.
Accepted text is passed through the game's character validation and finish logic,
without changing global keyboard settings.

## Regression checks

Managed classification tests (synthetic types; no game files required):

```powershell
.local/dotnet-sdk/dotnet.exe run --project android/runtime/tests/managed/Controls.Tests.csproj -c Release
```

Layout and binding tests, plus APK compilation:

```powershell
./scripts/build-android-hooks.ps1
. ./scripts/android-env.ps1
Push-Location src-tauri/gen/android
./gradlew.bat :app:testArm64DebugUnitTest :app:assembleArm64Debug -PcelemodPrebuiltRust=true
Pop-Location
```

Device checklist: title → saves → chapter → gameplay → Android Back → pause;
verify play icon, D-pad and bottom-right confirm; open options and verify back icon;
resume via both play icon and Android Back; hold climb while entering Talk range;
hold movement while opening pause and verify no stuck selection; background/return;
test journal, naming, dialogue, two-finger gameplay, fast taps, controller-opened
menus, and both touch preference combinations. Exit only through the confirmed
manager button or normal game exit. Use test saves for any progress-changing checks.
For the editor: drag jump and stick, switch preview and drag confirm, Save, reopen
and verify, Cancel a second edit, verify Back cancels without unpausing, and test
Reset both with Cancel and Save. Relaunch to verify positions persist.
For direct touch: initial title tap; main-menu button tap and swipe; pause row tap;
horizontal slider drag followed by vertical list drag; verify no release-confirm;
both chapter swipe axes and map-search shortcut; native text Cancel/accept; journal
page swipe; two-finger cancellation; letterbox touches; explicit key fallback;
controller-opened modal during a touch; background/return with no delayed input.

Custom non-Oui mod scenes and mods that entirely replace keyboard input remain
best-effort fallback, not a claim that every mod's UI has a specialized profile.

Adapter regression details: reflection resolves overloads by argument type (in
particular `ActiveFont.Measure(string)`, not `Measure(char)`). File selection uses
the focused controller and visible slot entities; the controller itself is normally
invisible. Main-menu buttons follow the parent's direct-render rules. Chapter
sidebar hit regions are limited to their 128-HUD-pixel spacing rather than the
overlapping 164-pixel artwork, and retain the game's journal-dependent placement:
map list sends ESC, while search sends Everest's MenuSearch binding.
