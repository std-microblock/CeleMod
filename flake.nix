{
  description = "CeleMod - Tauri 2 + React desktop app";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # Pinned by rev rather than to HEAD: a floating ref makes every evaluation
    # resolve HEAD through the GitHub API, which rate-limits with 403 even
    # though flake.lock already pins this rev.
    rust-overlay = {
      url = "github:oxalica/rust-overlay/74cebce67ef6671ea48fda353a5be2d229bd2920";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, rust-overlay }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];

      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);

      # rust-overlay is needed for the build too, not just the devShell: the
      # crate uses #![feature(try_blocks)], so rustPlatform must be nightly.
      pkgsFor = system:
        import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
          config = { };
        };

      # packages.<system> holds derivations only; `nix flake check` rejects
      # anything else it finds there.
      packagesFor = system:
        let
          pkgs = pkgsFor system;
          fromOverlay = self.overlays.default pkgs pkgs;
        in
        {
          inherit (fromOverlay) celemod celemod-ui;
          default = fromOverlay.celemod;
        };
    in
    {
      overlays.default = final: prev: import ./nix/lib.nix { pkgs = final; };

      packages = forAllSystems packagesFor;

      devShells = forAllSystems (system:
        {
          default = import ./nix/devshell.nix { pkgs = pkgsFor system; };
          ci = import ./nix/devshell.nix { pkgs = pkgsFor system; mode = "ci"; };
        });

      formatter = forAllSystems (system: (pkgsFor system).nixfmt);

      checks = forAllSystems (system:
        let
          pkgs = pkgsFor system;
          packages = packagesFor system;
        in
        {
          celemod-version = pkgs.runCommand "celemod-version-check" { } ''
            test "$(cat ${packages.celemod.version})" = "$(cat ${./version.txt})"
            touch $out
          '';

          # Guards against the packages silently collapsing to runCommand
          # placeholders, which `nix flake check --no-build` cannot tell apart
          # from a real derivation. Assert on the build inputs rather than
          # passthru.placeholder: a plain runCommand never sets that attribute.
          celemod-is-real = pkgs.runCommand "celemod-real-check" { } ''
            test "${toString (builtins.any (d: builtins.match ".*(rust|cargo).*" (d.name or "") != null) (packages.celemod.nativeBuildInputs or [ ]))}" = "1"
            test "${toString (builtins.length (packages.celemod-ui.nativeBuildInputs or [ ]))}" != "0"
            test "${if packages.celemod-ui ? pnpmDeps then "1" else "0"}" = "1"
            touch $out
          '';
        });
    };
}
