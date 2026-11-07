# Package derivations for CeleMod.
#
#   mkCelemodUi -> the Vite dist/ tree as its own derivation
#   mkCelemod   -> rustPlatform.buildRustPackage; $out/bin/cele-mod
#
# lib.nix wires these together; versions.nix holds every hash.
#
# rustPlatform must be a nightly toolchain: src-tauri/src/lib.rs uses
# #![feature(try_blocks)], which a stable rustc rejects with E0554.
{ lib
, stdenv
, rustPlatform
, pnpm_11
, pnpmConfigHook
, nodejs_22
, fetchPnpmDeps
, cargo-tauri
, wrapGAppsHook4
}:

let
  versions = import ./versions.nix;

  # version.txt at the repository root is the single source of truth.
  repoVersion = versions.version;
in
rec {
  inherit repoVersion;

  # -------------------------------------------------------------------------
  # Frontend: pnpm dependency snapshot (fixed output, network on first build)
  # -------------------------------------------------------------------------
  # nixpkgs 26.11 has no pkgs.pnpm.fetchDeps; the fetcher is the top-level
  # pkgs.fetchPnpmDeps, which requires fetcherVersion. Versions 1 and 2 were
  # removed; the value used here lives in versions.nix.
  celemodUiDeps = src: fetchPnpmDeps {
    pname = "celemod-ui-deps";
    version = repoVersion;
    inherit src;
    pnpm = pnpm_11;
    fetcherVersion = versions.pnpm.fetcherVersion;
    hash = versions.pnpm.depsHash;
  };

  # -------------------------------------------------------------------------
  # Frontend: build the Vite dist/ tree
  # -------------------------------------------------------------------------
  mkCelemodUi =
    { src
, pname ? "celemod-ui"
, version ? repoVersion
    # The pnpm lockfile lives in src/celemod-ui, so the dependency snapshot
    # must be taken from that subdirectory; the root has no lockfile.
    , pnpmDeps ? celemodUiDeps (src + "/src/celemod-ui")
    }:
    stdenv.mkDerivation {
      inherit pname version src;

      nativeBuildInputs = [ nodejs_22 pnpm_11 pnpmConfigHook ];

      inherit pnpmDeps;
      pnpmRoot = "src/celemod-ui";

      # A checkout may carry stale artefacts from a local dev run; pnpm aborts
      # on node_modules and a stale dist would mask a broken build.
      postPatch = ''
        rm -rf src/celemod-ui/node_modules src/celemod-ui/dist
      '';

      buildPhase = ''
        runHook preBuild
        export CI=true

        # Do not reassign HOME: pnpmConfigHook writes the store mapping into
        # HOME's pnpm config and pnpm's pre-run check reads it back. Moving HOME
        # makes pnpm re-run an online install after a successful offline one.
        export pnpm_config_verify_deps_before_run=false

        cd src/celemod-ui
        pnpm run build
        cd ../..
        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall
        mkdir -p $out
        cp -r src/celemod-ui/dist $out/dist
        runHook postInstall
      '';

      meta = {
        description = "CeleMod frontend (Vite/React) build output";
        inherit version;
        platforms = lib.platforms.unix;
      };
    };

  # -------------------------------------------------------------------------
  # Application: Tauri 2 shell built over the whole repository
  # -------------------------------------------------------------------------
  # Build through cargo-tauri's hook rather than a bare buildRustPackage: the
  # hook is what runs tauri-build with the custom-protocol feature, so the
  # frontend is embedded instead of being fetched from build.devUrl at runtime.
  #
  # Pass buildSubdir, not cargoRoot: cargoRoot also drives fetchCargoVendor
  # staging, which would then look for Cargo.lock inside src-tauri/. This repo
  # is a workspace whose Cargo.lock sits at the root.
  mkCelemod =
    { src
, pname ? "cele-mod"
, version ? repoVersion
    , buildSubdir ? "src-tauri"
    , cargoRoot ? "."
, cargoHash ? versions.cargoHash
, frontend ? mkCelemodUi { inherit src; }
, nativeBuildInputs ? [ ]
, buildInputs ? [ ]
, doCheck ? false
    }:
    let
      # cargo-tauri would otherwise re-run `pnpm build` itself through
      # beforeBuildCommand; the UI is already built by the frontend derivation.
      tauriOverrides = builtins.toFile "tauri-overrides.json" (
        builtins.toJSON { build.beforeBuildCommand = ""; }
      );
    in
    rustPlatform.buildRustPackage {
      inherit pname version src cargoRoot doCheck;

      # cargoHash must be TOP-LEVEL and cargoLock must be ABSENT.
      #
      # buildRustPackage prefers cargoLock over cargoHash whenever cargoLock is
      # set, even alongside a cargoHash; it then routes through importCargoLock,
      # which demands outputHashes for the pinned git dependency:
      #   No hash was found while vendoring the git dependency game-scanner-1.2.0
      # With cargoHash alone, fetchCargoVendor vendors the git dependency too.
      inherit cargoHash;

      # wrapGAppsHook4 wires XDG_DATA_DIRS and the GIO/GDK module paths that a
      # GTK app needs at runtime; without it the window renders unstyled.
      #
      # No pnpmConfigHook here: the UI already arrives as a finished
      # derivation via `frontend`, and the hook insists on a pnpmDeps it has
      # no use for in this derivation.
      nativeBuildInputs = [ cargo-tauri.hook wrapGAppsHook4 ]
        ++ nativeBuildInputs;
      inherit buildInputs;

      tauriBuildFlags = [ "-c" tauriOverrides ];

      # The frontend derivation owns the UI build; copy the result in so
      # tauri-build finds a populated frontendDist.
      postPatch = ''
        rm -rf src/celemod-ui/dist
        mkdir -p src/celemod-ui/dist
        cp -r ${frontend}/dist/. src/celemod-ui/dist/
        chmod -R u+w src/celemod-ui/dist
      '';

      preBuild = ''
        export TAURI_SKIP_DEVSERVER_BUILD=1
      '';

      buildAndTestSubdir = buildSubdir;
      cargoBuildFlags = [ "--bin" pname ];

      # prost-build 0.10.4 vendors protobuf and runs CMake on a pre-3.5
      # CMakeLists.txt, which modern CMake rejects. Upstream CI sets the same
      # escape hatch.
      env = {
        CMAKE_POLICY_VERSION_MINIMUM = "3.5";
      };

      meta = {
        description = "CeleMod - Celeste mod manager (Tauri 2 + React)";
        inherit version;
        homepage = "https://github.com/std-microblock/CeleMod";
        license = lib.licenses.mit;
        platforms = lib.platforms.linux;
        mainProgram = pname;
      };
    };
}
