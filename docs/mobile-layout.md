# Mobile layout and Android UI smoke tests

## Layout

- Android uses the compact layout; desktop windows use it below 760 CSS pixels.
- The manager is portrait (`MainActivity: userPortrait`). The SDL game remains
  sensor-landscape, including when SDL requests a resizable window orientation.
- Bottom navigation: Home, Search, Manage, Downloads and More. Game-dependent
  entries retain desktop availability conditions. More uses a native HTML dialog.
- Home includes two-column shortcuts. Android Steam onboarding stays above the
  game section when there is no game, and below shortcuts otherwise.
- Manage separates the Mod list and profiles. Binding sources are horizontal
  chips, with the keyboard/controller overview initially collapsed on phones.
- Settings, recommendation descriptions, filters and dialogs use the available
  width. The shell and overlays reserve system-bar safe areas. Lists retain
  bounded heights rather than scrolling underneath the bottom bar.
- `src/celemod-ui/src/styles/android.scss` contains compact overrides, loaded
  after route/theme styles. Virtual Mod rows own their padding and measured heights;
  adding padding to their viewport can clip the cards.

## Run on a connected debug phone

From the repository in PowerShell (coordinate exclusive phone access first):

```powershell
. ./scripts/android-env.ps1
./scripts/build-android.ps1
adb install -r src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk
adb shell am start -n cc.microblock.celemod/.MainActivity
$appPid = adb shell pidof cc.microblock.celemod
adb forward tcp:9223 localabstract:webview_devtools_remote_$appPid
node scripts/android-mobile-e2e.mjs

# Optional extended interactions / non-persisted theme checks:
$env:CELEMOD_TEST_THEME = 'material-you' # or fluent / vanilla
$env:CELEMOD_TEST_PAGES = 'Home,Manage,KeyBindings,RecommendMods,Settings'
$env:CELEMOD_TEST_DETAILS = '1'
node scripts/android-mobile-e2e.mjs
```

The helper assumes Chinese UI and an already selected game. It reads the debug
WebView DOM through CDP, taps through ADB, checks page width/visible overflow and
uncaught JS exceptions, and saves screenshots/reports in `.local/mobile-e2e/<theme>/`.
It stops if the manager is not foreground. It does not install Mods, modify bindings
or interact with Steam credentials. Theme checks temporarily change the DOM
attribute, not the saved preference.

## Verified on 2026-09-08

- Connected 23049RAD8C: 1080 × 2400 physical pixels, approximately 392 × 872 CSS.
- Frontend typecheck/build and Android debug APK build passed.
- Default theme: nine available routes plus Search filters; no page-width overflow
  or uncaught frontend exceptions. Loenn was disabled by fetched feature config
  during the complete route pass and was skipped, not claimed as tested.
- Material You / Fluent: Home, Manage, KeyBindings, RecommendMods and Settings.
- Home's eight available shortcuts, keyboard overview expand/collapse, controller
  mode, all three recommendation tabs, and Settings bottom.
- Visual inspection caught and fixed clipped recommendation descriptions, Settings
  grid min-content overflow, keyboard diagram overlap and generic theme button
  styles leaking into bottom navigation.
- Portrait manager → launch Everest → 2400 × 1080 landscape game → exit confirmation
  → portrait manager passed. No system rotation settings were modified.
- Deep-link tests: 3 passed. Dependency/display-name tests: 12 passed. The separate
  profile-install test could not start under plain tsx because its import graph
  includes a PNG; this is not a passing test result.

Online Search / Everest catalogue requests failed on the phone during this run.
Their error-state layouts were inspected, but online catalogue success, downloads,
installation and account flows are not covered by this UI smoke-test result.
