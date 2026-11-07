#!/usr/bin/env bash
# CeleMod devshell helper -- idempotent, safe to source repeatedly.
if [ "${CELEMOD_HOOK_SOURCED:-0}" = "1" ]; then
  return 0 2>/dev/null || true
fi
CELEMOD_HOOK_SOURCED=1
export CELEMOD_HOOK_SOURCED
echo "CeleMod devshell: rust $(rustc --version 2>/dev/null | cut -d' ' -f2), node $(node --version 2>/dev/null), pnpm $(pnpm --version 2>/dev/null)"

