# Pinned, machine-refreshable data for the CeleMod build.
#
# Refreshed by scripts/update-nix-hashes.sh; see nix/README.md. Every hash here
# came from a real fixed-output build failure, never from a guess.
#
# These attributes are REQUIRED: nix/tools.nix reads cargoHash,
# pnpm.fetcherVersion and pnpm.depsHash unconditionally, so trimming this to
# `{ }` breaks evaluation rather than degrading gracefully. The version is
# deliberately absent -- version.txt is the single source of truth and lib.nix
# reads it directly.
{
  # ---------------- Rust ----------------
  # Covers every locked crate (registry plus the one git dependency). Keep this
  # TOP-LEVEL in buildRustPackage: it only takes effect when cargoLock is absent.
  cargoHash = "sha256-xbEoLgpx0vQ0MO79KtVaGyxbg+bO7uTedqT6pmX4OGQ=";

  # The one git dependency in Cargo.lock:
  #   git+https://github.com/EqualGames/game-scanner?branch=dependabot%2Fcargo%2Fsysinfo-0.28.2#b476668896d3f9496c858fa3c9b3f97735b3837c
  gameScanner = {
    owner = "EqualGames";
    repo = "game-scanner";
    rev = "b476668896d3f9496c858fa3c9b3f97735b3837c";
    hash = "sha256-B4BhhI7yc9YI+11d4KoDZeQoH+WJwysVIm5MozWU9dc=";
  };

  # ---------------- Frontend (pnpm) ----------------
  # src/celemod-ui/pnpm-lock.yaml is lockfileVersion 9.0 and package.json pins
  # packageManager pnpm@11.13.1, so the build uses pkgs.pnpm_11 rather than
  # pkgs.pnpm. nixpkgs 26.11 removed fetcherVersion 1 and 2; this is the value
  # the locked nixpkgs still accepts.
  pnpm = {
    fetcherVersion = 4;
    depsHash = "sha256-jvYPUmkbi/rnRR7Sxwv+Z25voMUr5LlSsZKNtPB/R1s=";
  };
}
