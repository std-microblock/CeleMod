# CeleMod Nix build

A flake providing `packages.celemod`, `packages.celemod-ui`, `overlays.default`
and `devShells.{default,ci}` for `x86_64-linux` and `aarch64-linux`.

```bash
nix build .#celemod          # -> $out/bin/cele-mod
nix develop                  # rust nightly, node 22, pnpm 11, GTK/WebKit
nix flake check              # evaluation + real-package guard
```

## Layout

```
flake.nix              inputs, packages, overlay, devShells, checks
flake.lock             pins nixpkgs + rust-overlay; commit this
nix/lib.nix            overlay body: toolchain selection, wires tools.nix
nix/tools.nix          frontend and Tauri derivations
nix/devshell.nix       devShells
nix/versions.nix       every pinned hash
nix/hooks/             optional sourced shell helpers
scripts/update-nix-hashes.sh
```

> `nix/` must stay git-tracked. A flake in a git repository only sees tracked
> files, so an untracked `nix/` fails with
> `error: getting status of '.../nix/lib.nix': No such file or directory`
> even though the file is on disk.

## How the build works

Two derivations, both `x86_64-linux`:

| attribute | what | output |
|---|---|---|
| `mkCelemodUi` | Vite/React frontend built with pnpm | `$out/dist/` |
| `mkCelemod` | Tauri 2 shell via `rustPlatform.buildRustPackage` | `$out/bin/cele-mod` |

1. `fetchPnpmDeps` snapshots `src/celemod-ui/pnpm-lock.yaml` into a
   fixed-output derivation.
2. `mkCelemodUi` builds the site offline from that store.
3. `mkCelemod` builds the Rust workspace and its `postPatch` copies the
   finished `dist/` into `src/celemod-ui/dist/`, so `tauri-build` finds a
   populated `frontendDist` without running node or a dev server.

The Rust toolchain must be nightly: `src-tauri/src/lib.rs` uses
`#![feature(try_blocks)]`. `lib.nix` takes it from rust-overlay's
`rust-bin.nightly.latest.default`, which is a single derivation bundling cargo,
rustc and std. The component attrs do not work -- `.rustc` alone ships no std
sysroot and fails with `E0463: can't find crate for std`.

## Pinned inputs and hashes

`flake.lock` pins both inputs. `rust-overlay` is referenced by full rev rather
than a floating branch: a floating ref makes every evaluation hit the GitHub
API to resolve HEAD, which fails with a rate-limit `403` even though the lock
already pins the rev. Keep the URL in `flake.nix` and the locked rev in
`flake.lock` in sync.

`nix/versions.nix` holds three hashes, all produced by real fetch failures:

| key | covers |
|---|---|
| `cargoHash` | all 620 locked crates (619 registry + 1 git) |
| `gameScanner.hash` | the pinned `game-scanner` git dependency |
| `pnpm.depsHash` | the pnpm store for `src/celemod-ui` |

`pnpm.fetcherVersion` is `4`. nixpkgs 26.11 removed versions 1 and 2, and the
locked nixpkgs accepts 3, 4 or 5; 4 is what the hash was produced with.

## Refreshing hashes

```bash
./scripts/update-nix-hashes.sh --dry-run   # resolve and print, write nothing
./scripts/update-nix-hashes.sh             # rewrite nix/versions.nix
```

The script sets each hash to a deliberate fake, builds, and reads the
`got: sha256-...` line back. Nothing is guessed. It pins nixpkgs from the
committed `flake.lock`, so it can never hash against unstable HEAD.

After writing it validates every digest, asserts that each value equals the one
just measured, and restores the backup on failure. A second run against
unchanged inputs is byte-identical.

To bump the app version, update `version.txt` (and `src-tauri/Cargo.toml`'s
`version` to match), then re-run the script if `Cargo.lock` changed.

## Build notes

These are the non-obvious parts of the derivations. Each one is a real
constraint of this nixpkgs or this repository, not a workaround.

### `cargoHash` is top-level; `cargoLock` must be absent

`buildRustPackage` builds `cargoDeps` from `cargoLock` whenever that argument
is present at all, silently ignoring a top-level `cargoHash`. That routes
through `importCargoLock`, which needs `outputHashes` for the git dependency:

```text
error: No hash was found while vendoring the git dependency game-scanner-1.2.0
```

Supplying only `cargoHash` routes through `fetchCargoVendor` instead, which
handles the git dependency and needs no `outputHashes`. So `tools.nix` passes
no `cargoLock` at all. (`cargoHash` inside `cargoLock` is a separate, harder
failure: `unexpected argument 'cargoHash'` at `import-cargo-lock.nix:76`.)

### No `cargoRoot`

`cargoRoot` also drives vendor staging, so it would stage only `src-tauri/`,
which has no `Cargo.lock`:

```text
FileNotFoundError: [Errno 2] No such file or directory: 'Cargo.lock'
```

This repository is a cargo workspace whose `Cargo.toml` and `Cargo.lock` live
at the root, so vendoring runs from the root and the build subdirectory is
selected with `buildAndTestSubdir = "src-tauri"`.

### `CMAKE_POLICY_VERSION_MINIMUM = 3.5`

`prost-build 0.10.4` vendors protobuf and runs CMake on a pre-3.5
`CMakeLists.txt`, which modern CMake rejects. Upstream CI sets the same escape
hatch:

```text
CMake Error at CMakeLists.txt:2 (cmake_minimum_required):
  Compatibility with CMake < 3.5 has been removed from CMake.
```

### The pnpm deps snapshot needs `src/celemod-ui`

`mkCelemodUi` takes the repository root as `src`, but the dependency snapshot
must be taken from the subdirectory that holds the lockfile:

```nix
pnpmDeps ? celemodUiDeps (src + "/src/celemod-ui")
```

Passing the root produces a tarball with no celemod-ui packages, and the later
install falls back to the network and dies inside the sandbox.

### Do not reassign `HOME` in `buildPhase`

`pnpmConfigHook` writes the store mapping into `HOME`'s pnpm config, and pnpm's
pre-run dependency check reads it back. Moving `HOME` to `$TMPDIR` discards
that and makes pnpm re-run an online install after a successful offline one.
For the same reason `buildPhase` sets
`pnpm_config_verify_deps_before_run=false`.

### Tauri and `frontendDist`

`tauri-build` does not fail when `frontendDist` is missing -- it silently
produces a binary with no embedded UI. `dist/` is gitignored, so the derivation
must populate `src/celemod-ui/dist/` before cargo runs. `TAURI_SKIP_DEVSERVER_BUILD=1`
prevents any attempt to start a dev server.

## The real-package guard

`checks.<system>.celemod-is-real` fails the build if either package stops being
a real derivation. This matters because `nix flake check --no-build` cannot
tell a real derivation from an empty `runCommand` stub -- a stub is a valid
derivation, so the check would pass green.

The guard reads `nativeBuildInputs` and `pnpmDeps` rather than
`passthru.placeholder`: a plain `runCommand` never sets that attribute, so
testing it would pass on a genuine placeholder.

## Developer shells

`devShells.default` provides rust nightly with `rust-src`, `rustfmt`, `clippy`
and `rust-analyzer`; node 22; pnpm 11; and the full GTK/WebKit stack, plus the
`GIO_*`, `GDK_PIXBUF_*`, `XDG_DATA_DIRS` and `LD_LIBRARY_PATH` variables a Tauri
app needs at runtime. `devShells.ci` drops the interactive extras.

pnpm is pinned to `pnpm_11` because `package.json` declares
`packageManager: pnpm@11.13.1`; `pkgs.pnpm` tracks 12.x.

Inside a Nix `''` string, `${...}` is interpolation, so shell parameter
expansions in `shellHook` must be written with a doubled apostrophe, as in
`''${VAR:-default}`. Getting this wrong is a syntax error, not a warning.

### CI parity

`.github/workflows/Build.yml` installs `webkit2gtk-4.1`, `libappindicator3`,
`librsvg2`, `patchelf` and `zsync` on Linux. The devShell carries the first
four; `zsync` is intentionally left out because it is only needed by the
AppImage bundler, not by compilation or `nix build`.
