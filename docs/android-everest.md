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

- `dotnet run --project android/runtime-tests`: dependency preservation, binding
  versions, backup integrity/idempotence and log tee, plus existing runtime tests.
- `pnpm --dir src/celemod-ui exec node --import tsx --test src/components/installerProgress.test.ts`
- Rust unit tests in `installer_progress.rs` and `log_viewer.rs`.
- `scripts/build-android.ps1`: frontend, managed hooks, Android Rust and Kotlin.
- On-device installation should be tested in a separate game directory; do not
  use the user's live Saves/Mods for regression testing.
