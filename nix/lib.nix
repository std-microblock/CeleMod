# lib.nix -- the body of `overlays.default`.
#
#   overlays.default = final: prev: import ./nix/lib.nix { pkgs = final; };
#
# Only derivations are exported: `nix flake check` rejects a non-derivation
# under packages.<system>.*, so a bare `version` string must not live here.
{
  # `final` when used as an overlay body, so pkgs.cele-mod is self-consistent.
  pkgs,
  lib ? pkgs.lib,
  # overridable for tests; defaults to the repository root
  root ? ./..,
}:
let
  # --------------------------------------------------------------------------
  # Version: version.txt at the repository root is the single source of truth.
  # readFile is pure eval (no IFD); surrounding whitespace is trimmed so that
  #   nix eval --raw .#packages.x86_64-linux."cele-mod".version
  # prints exactly 1.2.2.
  # --------------------------------------------------------------------------
  versionFromFile =
    let raw = builtins.readFile (root + "/version.txt");
    in lib.strings.trim raw;

  version =
    let r = builtins.tryEval versionFromFile;
    in if r.success && r.value != "" then r.value else "0.0.0-unreleased";

  # --------------------------------------------------------------------------
  # Pinned, machine-refreshable data. Never required: every consumer below has
  # a fallback, so a missing or empty versions.nix still EVALUATES. A bad hash
  # then fails at fetch time, which is the correct place for that failure.
  # --------------------------------------------------------------------------
  versions =
    let r = builtins.tryEval (import ./versions.nix);
    in if r.success && builtins.isAttrs r.value then r.value else { };

  # --------------------------------------------------------------------------
  # src-tauri/src/lib.rs is #![feature(try_blocks)], so the compiler must be
  # nightly; rust-overlay provides it.
  #
  # Use the merged `.default` toolchain for BOTH makeRustPlatform slots. The
  # component attrs do not work: `selectLatestNightlyWith` returns a package
  # with no .cargo/.rustc, and the standalone `.rustc` ships no std sysroot
  # (E0463: can't find crate for `std`). `.default` bundles cargo + rustc +
  # std and already carries the targetPlatforms passthru buildRustPackage
  # reads.
  rustToolchain =
    if pkgs ? rust-bin then
      pkgs.rust-bin.nightly.latest.default
    else
      throw "CeleModBuild: nightly Rust required (src-tauri/src/lib.rs uses #![feature(try_blocks)]); import nixpkgs with rust-overlay or use this flake outputs";

  rustPlatform = pkgs.makeRustPlatform {
    cargo = rustToolchain;
    rustc = rustToolchain;
  };

  tools = import ./tools.nix {
    inherit lib rustPlatform;
    inherit (pkgs)
      stdenv
      fetchPnpmDeps
      pnpmConfigHook
      pnpm_11
      nodejs_22
      cargo-tauri
      wrapGAppsHook4;
  };

  # The GTK/WebKit stack the Tauri build links against. Keep in sync with the
  # buildInputs in nix/devshell.nix.
  tauriInputs = with pkgs; [
    pkg-config
    cmake
    patchelf
    glib
    gtk3
    webkitgtk_4_1
    libsoup_3
    librsvg
    libayatana-appindicator
    desktop-file-utils
    xdg-utils
    openssl
    glib-networking
    gsettings-desktop-schemas
    dconf
    libappindicator-gtk3
  ];

in
{
  # Attribute names follow the upstream crate, whose [package] and [[bin]] are
  # both `cele-mod`, so the attribute and the command you run are one string:
  # pkgs.cele-mod installs $out/bin/cele-mod.
  "cele-mod" = tools.mkCelemod {
    src = root;
    inherit version;
    inherit (versions) cargoHash;
    nativeBuildInputs = tauriInputs;
    buildInputs = tauriInputs;
  };

  # The frontend on its own, as $out/dist. It is a building block rather than
  # something you run: the application derivation copies this tree into
  # src/celemod-ui/dist so tauri-build can embed it into the binary. It is
  # exposed because it is by far the cheapest target to build and inspect when
  # iterating on the UI.
  "cele-mod-ui" = tools.mkCelemodUi {
    src = root;
    inherit version;
  };
}
