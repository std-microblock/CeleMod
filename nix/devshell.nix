# Developer shells.
#
#   nix develop .#default   nightly rust + node/pnpm + GTK/WebKit
#   nix develop .#ci        the same shell without interactive conveniences
#
# `pkgs` must carry rust-overlay, or pkgs.rust-bin does not exist.
{ pkgs, mode ? "default" }:
let
  lib = pkgs.lib;
  isCi = mode == "ci";

  # rust-toolchain.toml pins channel = "nightly". Extensions are what cargo fmt,
  # cargo clippy and rust-analyzer need in order to work.
  rust = pkgs.rust-bin.selectLatestNightlyWith (toolchain:
    toolchain.default.override {
      extensions = [ "rust-src" "rustfmt" "clippy" "rust-analyzer" ];
    });

  # package.json says packageManager pnpm@11.13.1 and the lockfile is 9.0,
  # so pnpm_11 -- NOT pkgs.pnpm, which tracks 12.x in nixpkgs 26.11.
  pnpm = pkgs.pnpm_11;

  nativeBuildInputs = with pkgs; [
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
  ];

  buildInputs = with pkgs; [
    openssl
    glib-networking
    gsettings-desktop-schemas
    dconf
    libappindicator-gtk3
    webkitgtk_4_1
    gtk3
    libsoup_3
    librsvg
  ];

  # ---------------------------------------------------------------------
  # Runtime env for the GTK/WebKit stack.
  #
  # Escaping: inside a Nix '' string ${...} is Nix interpolation, so shell
  # parameter expansions must be written with a doubled apostrophe, as in
  # ''${VAR:-default}. Getting this wrong is a hard syntax error.
  # ---------------------------------------------------------------------
  gioModulePath =
    lib.makeSearchPath "lib/gio/modules" [ pkgs.glib.out pkgs.glib-networking pkgs.dconf ];
  gdkPixbufModulePath =
    lib.makeSearchPath "lib/gdk-pixbuf-2.0/2.10.0/loaders" [ pkgs.librsvg pkgs.gdk-pixbuf ];

  shellHook = ''
    if [ -n "''${CELEMOD_SHELL_QUIET:-}" ]; then
      return 0 2>/dev/null || true
    fi

    export GIO_EXTRA_MODULES="${gioModulePath}"
    export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules"
    export GDK_PIXBUF_MODULE_PATH="${gdkPixbufModulePath}"
    export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share:${pkgs.gtk3}/share:${pkgs.shared-mime-info}/share:''${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
    export LD_LIBRARY_PATH="${lib.makeLibraryPath buildInputs}:''${LD_LIBRARY_PATH:-}"
    # Several vendored CMakeLists predate CMake 4; without this they hard-error.
    export CMAKE_POLICY_VERSION_MINIMUM="''${CMAKE_POLICY_VERSION_MINIMUM:-3.5}"
    # corepack must never try to download a pnpm shim during activation.
    export COREPACK_ENABLE_AUTO_PIN=0
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  '';
in
pkgs.mkShell {
  name = if isCi then "celemod-ci" else "celemod-devenv";

  inherit nativeBuildInputs buildInputs shellHook;

  packages = [
    rust
    pkgs.nodejs_22
    pnpm
    pkgs.corepack_22
  ] ++ lib.optionals (!isCi) [
    pkgs.cargo-tauri
    pkgs.rust-analyzer
  ];

  # Deliberately plain: `nix develop --command bash -c ...` must work, so the
  # hook is idempotent and never changes the caller error policy.
  RUST_BACKTRACE = "1";
  CARGO_TERM_COLOR = "always";
}
