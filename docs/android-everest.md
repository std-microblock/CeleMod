# Android Everest installation

## Edition-specific MonoMod dependencies

EverestUltra 1.6487.0 uses `MonoMod.RuntimeDetour.ILHookTransaction`. RAL 2.1.1's
bundled RuntimeDetour does not contain it. Replacing every MonoMod DLL with RAL's
version makes MiniInstaller fail with `RelinkTargetNotFoundException` while
patching `Celeste.Mod.Everest.Loader.LoadPendingStartupMods`.

`RuntimeHost.installMonoMod` preserves an incoming RuntimeDetour that contains
the Ultra transaction API. RAL's Android Core/Utils still supply the platform
backend; **do not preserve the desktop MonoMod.Core instead** (its Android
system implementation is not implemented in this Ultra build).

The CeleMod startup hook runs first and inspects RuntimeDetour with Cecil. For
Ultra, it raises the assembly binding version only when necessary to satisfy
RAL Harmony, then preloads it before calling the pinned RAL startup hook. The
transaction implementation itself is retained, not replaced with no-op methods.
Original bytes are backed up by SHA-256 under `.celemod-runtime-backup`. Signed,
native/mixed-mode and damaged-backup inputs fail without replacing the original.
Official Everest follows the original RAL dependency path. Both installer and
game processes use the same dependency selection.

When changing either bundled runtime or supported Ultra versions, verify both
installation and launch; matching assembly versions alone is not proof of
binary compatibility with a different MonoMod backend.

## Progress and diagnostics

### Crash reporting without a desktop log opener

`RuntimeHost` sets `EVEREST_NO_ERRORLOG_ON_CRASH=1` before entering the managed
runtime. Everest still writes the original exception and follows its normal
failure/exit path, but skips launching `errorLog.txt` through `Process.Start`.
This avoids a secondary `Win32Exception` from `Monocle.ErrorLog.orig_Open`
masking the actual failure on Android. This uses Everest's existing switch,
not a global Process.Start patch or suppression of game exceptions.

`GameLog` tees managed stdout/stderr to external `files/logs/game.log` before
loading the RAL hook, and flushes each write. The app's **游戏日志** viewer reads
that same file; Everest's own `log.txt` and error log are left unchanged.
Unhandled managed exceptions are also captured. File/console sink failures are
best-effort and must not replace the original exception. The host truncates the
game log once per launch, then native and managed writers both append so their
separate file offsets do not overwrite earlier diagnostics.

Offline runtime tests cover exception/inner-exception/stack preservation, both
console streams, repeat installation, append behavior, unavailable files and
broken sinks. Device verification should provoke a controlled failure in a
separate test game and confirm the original error appears in **游戏日志** without
an `ErrorLog.orig_Open` exception; do not alter the user's live Mods/Saves.

### Mod console colors

The Android game startup hook installs `ConsoleColors` after RAL's dependency
resolver and before loading game/mod code. Logcat has no terminal color support;
`Console.ForegroundColor` and `BackgroundColor` therefore keep process-local
state (gray on black by default), and `ResetColor` restores those defaults.
Getters and setters are both patched, so mods can save/set/restore colors without
calling the unsupported Android console backend. Invalid color values still
throw; text output and other exceptions are not intercepted.

This addresses ChroniaHelper 1.54.0 throwing `PlatformNotSupportedException` in
`ChroniaHelper.Utils.Log.Output` during module loading. It does not require
modifying or disabling the mod. Offline runtime tests check patch registration,
all 16 colors, reset, save/restore, invalid values and unchanged log writers;
the installed Android APK must also be tested with the real mod to verify the
Harmony detours on the bundled CoreCLR.

Device check (2026-09-09, 23049RAD8C, debug APK 1.1.11 / Everest 6531):
ChroniaHelper 1.54.0 registered successfully with the existing 100-candidate mod
set, and touch navigation reached `Celeste.OuiMainMenu` and Mod Options.
The original nine save/settings files and `Mods/blacklist.txt` remained
byte-identical. Startup still had a long starfield wait before reaching the
title; this change is not a loading-performance fix. Mod Options separately
reported missing dependencies for CanvasContest and StrawberryJam2021; those
were not installed or disabled as part of this compatibility fix.

### Installer logging

The embedded Android host redirects .NET Console to logcat, bypassing ordinary
stdout descriptor redirection. `InstallerLog` tees managed output to the fixed
UTF-8 `files/logs/installer.log` file, retaining normal Console output too.

Rust waits for MiniInstaller on a separate scoped worker and publishes a bounded
log snapshot once per second. An install-session marker prevents stale logs from
a previous attempt appearing in a new run. The progress payload uses the existing
status callback with an `Android installer:` JSON suffix and `-1` for unknown
percentage. The frontend displays real milestones (1–7), total installer elapsed
time and the most recent log line. Stage numbers are **not time percentages**;
short stages may finish between samples.

Errors include the final 45 log lines. The app's log viewer reads the same file.
A disappeared installer process is reported promptly; after a 15-minute timeout,
stopping the service also terminates its CoreCLR process. Successful completion
is delivered after the retiring process has had time to exit, avoiding reuse on
an immediate retry.

## Verification

Android runtime settings include **跟随游戏震动**, default off and applied on the
next game launch. This mirrors final gamepad motor output to the phone (including
without a connected gamepad), respecting the game's rumble setting. It is separate
from touch-button enter/leave feedback and stops on focus loss/background/exit.
See `android/runtime/TOUCH_CONTROLS.md` for the bridge and safety-lease contract.

- `dotnet run --project android/runtime-tests`: dependency preservation, binding
  versions, backup integrity/idempotence and log tee, plus existing runtime tests.
- `pnpm --dir src/celemod-ui exec node --import tsx --test src/components/installerProgress.test.ts`
- Rust unit tests in `installer_progress.rs` and `log_viewer.rs`.
- `scripts/build-android.ps1`: frontend, managed hooks, Android Rust and Kotlin.
- On-device installation should be tested in a separate game directory; do not
  use the user's live Saves/Mods for regression testing.
