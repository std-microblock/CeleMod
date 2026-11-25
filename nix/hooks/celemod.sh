#!/usr/bin/env bash
# Sourced by devShells.default. Idempotent and safe under `nix develop
# --command`: no `set -e`, no exit status changes.
if [ "${CELEMOD_HOOK_SOURCED:-0}" = "1" ]; then
  return 0 2>/dev/null || true
fi
CELEMOD_HOOK_SOURCED=1
export CELEMOD_HOOK_SOURCED

printf 'CeleMod devshell: rust %s, node %s, pnpm %s\n' \
  "$(rustc --version 2>/dev/null | cut -d' ' -f2)" \
  "$(node --version 2>/dev/null)" \
  "$(pnpm --version 2>/dev/null)"
printf '  build: nix build .#celemod  |  dev: pnpm --dir src/celemod-ui tauri dev\n'

return 0 2>/dev/null || true
