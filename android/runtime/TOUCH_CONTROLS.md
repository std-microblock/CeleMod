# Android contextual touch controls

`GameControls.cs` samples **actual game state on the Engine.Update thread**, at most
once every 50 ms. A single background writer atomically replaces the versioned
`cache/game-controls-<pid>.json` snapshot only when it changes. Android reads on a
worker thread and applies layouts on the UI thread. No screenshot recognition,
pause-key toggles, proprietary game references, or persistent game setting changes.

## Profiles

| Context | Left | Bottom right / other actions | Top right |
| --- | --- | --- | --- |
| Gameplay | Fixed/floating eight-way stick, four buttons, or eight buttons | Jump, dash, grab; interaction appears in Talk range | Pause icon / bound Pause |
| Pause main menu | Cardinal D-pad | Confirm, cancel | **Play/resume icon / bound Pause** |
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
| Menu transition animation | Hidden | Hidden | Hidden (fixed editor/exit/mode switch remain) |
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
  available even when virtual keys are off. It does not save the game for you.
- The **显示虚拟按键** switch controls the complete touch overlay, including gameplay actions and
  direction controls. When it is off, only edit/exit remain and other touches pass through.
- Bindings are read from `Celeste.Input` and `Settings`, including menu directions,
  gameplay movement, interaction and Pause. Supported keyboard bindings use their
  first Android-representable key. Only missing metadata (e.g. an unavailable hook)
  falls back to vanilla keyboard defaults. Explicitly empty/controller-only or
  unsupported bindings inject no key, rather than another action's rebound default;
  these virtual actions require a supported keyboard binding. No game bindings are overwritten.
- The stick and gameplay D-pad prefer common direction bindings. When a common
  direction has no usable key, they hold its `MoveOnly` and `DashOnly` bindings
  together, so split movement/aim layouts still work. Menu directions stay separate.
  Live binding changes release old holds/pulses before using the new keys.
  Direct menu touch invokes current semantic actions and does not depend on C/X.
- A profile, UI, binding, focus, size or lifecycle change releases owned keys and
  cancels pending pulses. Changes to Talk availability do not interrupt held climb.
- Gameplay supports independent multi-touch action holds and eight directions.
  Menu D-pad input is cardinal, slides between keys and releases outside the pad.
  Short taps are held briefly so SDL keydown/up cannot vanish between FNA frames.
- Native shapes draw all navigation/pause/resume/confirm icons, independent of
  installed fonts. The overlay extends into system-bar/cutout areas; only fixed
  toolbar controls retain safe insets. Physical cutouts/system gestures remain
  subject to Android's touch handling.

## Position editor

- Tap the permanent **编辑** pencil at the top left. Drag any outlined button or
  the stick; these editor touches never inject game keys. Known gameplay receives
  one pause request first; leaving the editor does not automatically resume play.
- **到菜单 / 到游戏** previews both layouts without navigating the game. Game
  actions/stick and menu actions/D-pad have separate positions; pause/resume and
  auxiliary icons use shared positions. Menu primary/secondary positions remain
  consistent when confirm changes to continue, character entry, or close.
- The preview lists every control its layout can show, including the ones only
  some scenes display: 交互 (Talk) away from an NPC, MiaoNet 聊天 / 玩家, CollabUtils
  大厅地图 and the 确定 / 返回 pair of unknown Mod scenes. Each keeps an editable
  position and style per layout instead of appearing only during play at a default
  position no edit could reach.
- **保存** applies and persists both previews. **取消** or Android Back discards
  edits. **重置** asks for confirmation and resets the current orientation's draft;
  it is not permanent until Save, and Cancel can still undo it.
- Positions are stored as normalized full-overlay centers in private Android
  preferences, independently for landscape and portrait. They survive game and
  app restarts and scale to screen-size changes. Only centers are clamped to the
  screen: controls may extend beyond its edges or overlap the toolbar area.
  The fixed toolbar draws on top and wins hit tests, keeping Save/Cancel/Exit
  reachable. Old safe-viewport coordinates are converted when saving an edit.
- **合并按钮** is a direction-pad option, shown when editing the four/eight
  direction controls. In individual mode each direction is laid out separately;
  in merged mode the four/eight controls become one direction-pad layout group.
  Dragging any direction translates the whole group with one edge-clamped offset,
  preserving spacing. Size and changed properties apply to that pad only; action
  buttons, the stick, and toolbar remain independently editable. The mode and edits
  use the same Save/Cancel/Reset transaction.
- Editor controls are available even with touch gameplay disabled; previewing and
  saving do not change the user's touch-enable settings. The editor shows the
  selected gameplay direction style (stick or D-pad).
- Incoming scene changes do not replace the editor preview. The latest real
  scene is applied after Save/Cancel. A screen-orientation change cancels an
  unsaved draft with a message; ordinary resizing retains normalized positions.
- Layout tests cover round-trip persistence, corrupt input, cancel/reset isolation,
  drag cancellation, geometry scaling, screen edges, and toolbar protection.

### Size and slide behavior

- In the editor, **drag** to move a control; **tap without dragging** to open its
  settings. Each virtual button and the stick has an independent size from 50% to
  300%. Visual and hit-test bounds use the same size without shrinking at screen
  edges. Fixed toolbar controls stay at their normal size and draw above enlarged
  controls.
- Gameplay action buttons additionally choose what a finger that starts there does:
  **Transfer** releases A on leaving and holds only the action under the finger;
  **Additive** keeps A and every action crossed until that finger lifts;
  **Hold** retains only the original A regardless of drifting (the existing default).
  Sweeps never activate the editor, exit, pause, or other toolbar controls. Directions
  retain their slide navigation; eight-button diagonals hold both resolved axes,
  including split movement/aim bindings, rather than introducing new game bindings.
- The starting button's behavior controls the entire gesture; different fingers
  have independent ownership. Lifting/cancelling or changing scene/layout/focus
  releases holds. Shared/rebound keycodes still release only when all owners do.
- Settings first apply to the editor draft; **Save** persists position, size, and
  behavior together per orientation. **Cancel** discards all three, and **Reset**
  resets all three only in the draft. Existing layouts keep 100% size and Hold.
- Menu Leave/Enter animations have an explicit `transition` state. They no longer
  briefly fall back to virtual controls when `Current` or direct targets disappear;
  stale touch targets are invalidated rather than kept clickable during animation.

### Direction mode, feedback and opacity

- In the gameplay layout editor, tap the stick or any direction button to choose
  **固定摇杆 / 浮动摇杆 / 四键按钮 / 八键按钮**. The eight-button layout adds four explicit diagonal
  buttons around an empty center. Menus retain cardinal-only navigation. Existing
  launcher virtual-key switch is respected; an unset mode follows the old
  joystick preference. Switching modes preserves the hidden controls' positions
  and styles so switching back is non-destructive.
- **浮动摇杆** starts anywhere in the left half of the overlay, below the
  fixed toolbar, excluding button hit regions. It appears centered exactly at
  touch-down and initially sends no direction; dragging determines direction.
  The first finger owns a latched center until lift/cancel, even when dragging
  outside the activation region. Other fingers can use action buttons but cannot
  recenter or release it. When idle it is hidden; the editor shows its activation
  region and a preview that can be tapped for settings. Preview dragging does not
  change the region or overwrite the fixed stick's saved anchor. Menus keep their
  normal direct-touch/cardinal navigation. Both stick modes share size, dead zone,
  opacity and feedback settings.
- **摇杆显示模式 → 圆环模式** works with both fixed and floating sticks. Eight
  equal 45° colored annular sectors match the input directions; the active sector
  highlights using the same direction calculation as SDL input. The center hole
  matches the configured dead zone and is never painted. Returning to the dead
  zone, lifting or cancelling clears highlighting. Classic stick display remains
  the default for existing layouts.
- **死区比例** is adjustable from 0–90% of the base radius in 1% increments,
  defaulting to the previous 18%. A faint circle indicates its size. Dead-zone
  motion sends no direction; 0% still leaves the exact center neutral. The separate
  **进入死区时震动** switch and strength (11 presets / 1% increments) trigger only
  when an active direction returns to neutral. Staying neutral, initially pressing
  in the dead zone, lifting or cancellation never trigger this effect. The new
  switch defaults off and persists/cancels/resets with the other stick settings.
- In a direction button's settings, check **应用到四键 / 应用到八键** to copy
  its size, opacity, entry/exit feedback and strengths, and outside-hold behavior
  to the selected direction group. It is opt-in; individual editing stays the
  default. Positions, action buttons, the stick and the other layout are unchanged.
  A four-key batch leaves hidden diagonals untouched; an eight-key batch includes
  all four diagonals. Menu batches always affect only their four cardinal buttons.
  Batch edits use the same draft/Save/Cancel/Reset transaction as single edits.
- Direction buttons independently choose **移出后松开** (the existing default)
  or **移出后保持最后方向** while the finger stays down. Both switch to another
  direction when the finger enters it; neither accumulates crossed directions.
  The starting button's policy lasts for that finger's gesture. Lifting/cancelling,
  entering the editor, or changing scenes/focus releases ownership normally.
  Physical entry/exit vibration remains independent of a held direction.
- Each editable button (including menu buttons) and the stick has **进入时震动** and
  **离开时震动**, independently enabled with separate 0–100% strength sliders.
  Each has 11 quick presets (0, 10, …, 100%) and 1% slider increments (101 levels);
  custom strengths survive reopening and saving without rounding to a preset.
  Both default off. Entry includes touch-down/sliding in; exit includes sliding
  out/lifting. Feedback tracks physical contact, not latched HOLD/ADDITIVE actions,
  SDL minimum key pulses, or keycode aliases. Stationary move events do not repeat;
  multiple fingers on one control generate entry on the first and exit on the last.
  Simultaneous changes use the strongest configured effect, for a single 20 ms
  pulse. All sources share a quadratic phone-amplitude curve (20% / 50% / 100%
  touch strength sends amplitudes 10 / 63 / 255), increasing weak/medium/full
  contrast without using pulse length as strength. Zero strength is silent.
  Each strength slider has an explicit **试震** button using the current draft
  value and the same 20 ms output path, even if its feedback switch is off. It
  does not save/enable anything; dialog focus loss/dismissal stops the preview.
  Devices without amplitude control use the default motor amplitude and cannot
  provide real amplitude differences; the editor explains this limitation.
  Missing hardware/service/permission must not interrupt input.
- **不透明度（Opacity）** scales the entire original control appearance (background,
  icon and text) from 0–100%. It does not shrink or disable the hit region. In the
  editor, a 25% visibility floor keeps fully transparent controls recoverable.
  Fixed editor/exit controls remain visible and are not customizable.
- The stick additionally has independent **切换到斜向时震动** (45°, 135°, 225°,
  315°) and **切换到正向时震动** (0°/360°, 90°, 180°, 270°) switches and strengths.
  Each defaults off and offers the same 11 presets / 1% fine adjustment. Feedback
  uses the exact eight-way sectors used for input, not exact-angle equality. A
  change to another cardinal or another diagonal also counts, but remaining in
  the same sector does not repeat. Entering a direction from the configured dead
  zone counts as a change; returning to neutral uses the separate dead-zone
  feedback setting. Releasing/cancelling does not trigger these direction/dead-zone
  groups. Contact entry/exit settings remain separate. Simultaneous contact
  and direction changes merge into one pulse at the strongest configured strength.
  Both groups persist with the stick's existing per-orientation draft settings;
  old styles load without enabling any new vibration.
- All these settings join the existing draft/save/cancel/reset transaction and are
  stored separately for portrait/landscape. The v2 style format accepts legacy v1
  size/slide data with unchanged appearance and no vibration. Scene/focus/layout
  changes and cancelled gestures clear contact history silently.

Device checks: cycle through all three modes and back, test each diagonal and a
diagonal-to-cardinal slide with another finger holding Jump/Grab, then open a menu
and verify only four directions. Set different entry/exit strengths on two buttons,
slide A → outside → B, hold still, re-enter, lift, and repeat with HOLD/ADDITIVE and
two fingers on one button. Test each toggle off and strength 0. Set opacity to 0,
25 and 100%; verify invisible hit regions and editor recovery. Save/relaunch,
Cancel, Reset+Cancel, Reset+Save, and rotate to check independent persistence.
For batch/hold settings: edit one direction and apply to four/eight, verify all
target styles match without moving any control, and check that menu/action styles
are unchanged. Test both outside policies with A → outside → B → outside → lift,
including diagonals and a second finger holding an action. Verify scene changes,
focus loss and gesture cancellation release held directions. Cancel both the
settings dialog and the full editor after a batch; confirm neither saves changes.
For stick feedback: enable only the diagonal group, then only the cardinal group,
then both with distinct strengths. Rotate through all eight sectors, jump directly
between two cardinals / diagonals, remain inside a sector, return to the dead zone
and re-enter, then lift/cancel and start again. Check 0% strength, Save/Cancel/Reset,
portrait/landscape persistence, and simultaneous button and stick transitions.
For dead zone/floating mode: test 0%, 18%, 50% and 90%; move out and return to
neutral, hold there, lift and cancel. Tap several left-side positions (including
edges), confirm no movement until dragging, keep the base anchored while dragging
outside the region, and verify a second finger can jump without moving the base.
Touches on buttons or outside the activation region must not spawn a stick. Check
the toolbar remains usable, idle sticks disappear, menu/focus changes release
input, and switching back restores the saved fixed anchor. Test Save/Cancel/Reset
and relaunch to verify both new settings and the selected mode persist.

## Direct UI touch

CollabUtils2 lobby UI and MiaoNet chat have dedicated adapters; see `MOD_TOUCH.md`
for supported package versions, controls, fallbacks, and verification limits.

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

Architecture: the CeleMod startup hook installs **runtime-only MonoMod managed hooks** in
Engine.Update and VirtualButton.Pressed/consumption. These join the same detour chain
as Everest mods: a raw Harmony entrypoint detour can be silently superseded by a
later mod Hook/ILHook, leaving installation logs but no state snapshots. The hooks
retain their lifetime and call the current original chain exactly once. A separate
first-update log confirms that sampling actually runs, not just that installation
returned successfully. It does not rewrite Celeste or
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
menus, and with virtual keys both enabled and disabled. Exit only through the confirmed
manager button or normal game exit. Use test saves for any progress-changing checks.
For rebinding: move jump/dash/grab/talk/pause and menu confirm/cancel/directions to
distinct keys; verify both direct touch and virtual navigation. Clear a common
direction and bind its MoveOnly/DashOnly alternatives; check movement and diagonal
dash with both stick and D-pad. Clear a binding and assign its old default to another
action: the unbound virtual button must not trigger that other action. Change a
binding during a hold and verify the old key is released without a delayed pulse.
For the editor: drag jump and stick, switch preview and drag confirm, keep a
聊天 / 玩家 / 大厅地图 Mod shortcut and the 确定 / 返回 pair of an unknown Mod scene
editable instead of frozen at a default, Save, reopen and verify, Cancel a second
edit, verify Back cancels without unpausing, and test Reset both with Cancel and
Save. Relaunch to verify positions persist.
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

Hook regression: keep update/input-hooking mods enabled (including MotionSmoothing
and SpeedrunTool), relaunch, and check for both the first-update log and the current
PID's `game-controls-<pid>.json`. Verify title tap reaches the main menu and snapshots
follow subsequent UI changes. The host tests also exercise typed original delegates,
post-update pumping, real and synthetic button presses, consumption, UI/scene
invalidation, and propagation of original game exceptions.

## Game-output phone vibration

- Manager settings → Android 游戏运行时 → **跟随游戏震动** (`gameRumble`, default
  false, applied on the next game launch). Existing settings files remain off;
  partial setting updates preserve the virtual-key switch.
- A managed detour observes `FNA GamePad.SetVibration(PlayerIndex, float, float)`
  after the original call, including when it returns false because no physical
  controller is attached. Celeste's own rumble off/half/full setting, timing,
  arbitration and stop commands remain upstream; no key/gesture guesses and no
  simulated controller connection. Mods using the same FNA output are also mirrored.
- The stronger motor across the four logical pads maps to a 1–255 logical
  amplitude, then the shared quadratic phone-amplitude curve is applied once
  after mixing with touch feedback. Game durations and stop commands are unchanged.
  SDL's existing `SDL_AndroidSendMessage` JNI channel uses user command
  `0xCE01`; no native library changes, files or background polling are needed.
- An independent Engine.Update detour renews active output every 100 ms; the Android
  lease expires after 300 ms without updates. Focus loss, backgrounding and exit
  clear both sources immediately. Resuming does not replay stored Android effects.
  Equal-amplitude heartbeats only extend the lease: an already playing motor is
  not restarted until its finite pulse ends. Changes of output amplitude still
  take effect immediately, and all source expiry deadlines remain observed.
- Touch enter/leave pulses keep their own switches and 20 ms durations. The shared
  phone motor mixes them with game output by maximum amplitude, restoring remaining
  game output after a touch pulse; a game stop never cancels an active touch pulse.
  Devices without amplitude control use the system's default strength. Missing
  hardware/permission/service failures must never interrupt gameplay.
- Host coverage: `dotnet run --project android/runtime/tests/managed` and Gradle
  `:app:testArm64DebugUnitTest` (`VibrationStateTest`, `VibrationPlayerTest`).
  Device strength check: use the editor's **试震** at 20% / 50% / 100%; all three
  last 20 ms, and the motor must receive distinct amplitudes rather than different
  durations. Actual perceptual separation must be checked on the device.
  Device smoke checks: enable
  with virtual keys off; trigger dash/landing rumble without a gamepad; check
  half/off in the game's settings; combine touch pulses; background and return;
  disable and relaunch. Physical controller rumble should remain unchanged.
