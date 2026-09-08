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
- The top-left exit icon is independent, **always asks for confirmation**, and is
  available even when both touch options are off. It does not save the game for you.
- Enabling only the stick still provides complete menu navigation and confirmation.
  Disabling both options leaves only exit; other touches pass through.
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

Custom non-Oui mod scenes and mods that entirely replace keyboard input remain
best-effort fallback, not a claim that every mod's UI has a specialized profile.
