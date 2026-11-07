#!/usr/bin/env bash
# CeleMod CI helper -- sourced by devShells.ci. Must stay non-interactive.
# No `set -e`: this is sourced, so it must not change the caller error policy.

export CI="${CI:-1}"
export CELEMOD_CI=1
export COREPACK_ENABLE_AUTO_PIN=0
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Deterministic, colourless output in CI logs.
export CARGO_TERM_COLOR="${CARGO_TERM_COLOR:-never}"
export RUST_BACKTRACE="${RUST_BACKTRACE:-1}"
