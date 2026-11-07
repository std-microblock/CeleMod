#!/usr/bin/env bash
# Refresh every hash in nix/versions.nix.
#
#  * Hashes are never guessed: each is read back from the got-sha256 line of a
#    deliberate fakeHash build failure, i.e. a real derivation of the real input.
#  * Idempotent: re-running against unchanged inputs rewrites the file
#    byte-identically, so `git diff --exit-code nix/versions.nix` stays clean.
#  * nixpkgs is pinned from the committed flake.lock, never resolved from the
#    registry or unstable HEAD.
#
# Usage: scripts/update-nix-hashes.sh [--repo-root DIR] [--dry-run]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${CELEMOD_REPO_ROOT:-$(dirname "$HERE")}"
if [ ! -f "$REPO_ROOT/flake.nix" ]; then
  echo "ERROR: $REPO_ROOT does not look like the CeleMod checkout." >&2
  echo "       Pass --repo-root DIR or set CELEMOD_REPO_ROOT." >&2
  exit 1
fi
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --repo-root) REPO_ROOT="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=1; shift ;;
    -h|--help)   sed -n "2,16p" "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

OUT_DIR="$REPO_ROOT/nix"
VERSIONS="$OUT_DIR/versions.nix"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
[ -f "$VERSIONS" ] || { echo "missing $VERSIONS" >&2; exit 1; }
mkdir -p "$WORK"

# Optional: point nix at a throwaway HOME/cache (useful in sandboxes whose
# real HOME is not writable).
if [ -n "${CELEMOD_NIX_HOME:-}" ]; then
  mkdir -p "$CELEMOD_NIX_HOME"
  export HOME="$CELEMOD_NIX_HOME"
  export XDG_CACHE_HOME="$HOME/.cache" XDG_STATE_HOME="$HOME/.state" TMPDIR="$HOME"
  mkdir -p "$XDG_CACHE_HOME" "$XDG_STATE_HOME"
fi
NIX=(nix --extra-experimental-features "nix-command flakes")

echo "== repo root : $REPO_ROOT"
echo "== versions  : $VERSIONS"

# Pin nixpkgs from the committed flake.lock; never from the registry.
NIXPKGS_REV="$(sed -n "s/.*\"rev\": \"\([0-9a-f]\{40\}\)\".*/\1/p" "$REPO_ROOT/flake.lock" | head -1)"
NIXPKGS_NAR="$(sed -n "s/.*\"narHash\": \"\(sha256-[^\"]*\)\".*/\1/p" "$REPO_ROOT/flake.lock" | head -1)"
if [ -z "$NIXPKGS_REV" ] || [ -z "$NIXPKGS_NAR" ]; then
  echo "ERROR: cannot read nixpkgs rev/narHash from $REPO_ROOT/flake.lock" >&2; exit 1
fi
echo "== nixpkgs   : $NIXPKGS_REV"
echo "== narHash   : $NIXPKGS_NAR"

cat > "$WORK/nixpkgs-locked.nix" <<EOF
builtins.fetchTarball {
  url = "https://github.com/NixOS/nixpkgs/archive/$NIXPKGS_REV.tar.gz";
  sha256 = "$NIXPKGS_NAR";
}
EOF
PINS="$(mktemp)"

get_hash() {
  local label="$1" expr="$2" varname="$3" got
  local log="$WORK/$label.log"
  echo "--> resolving $label" >&2
  if "${NIX[@]}" build --impure --no-link --no-write-lock-file \
       --print-out-paths --expr "(import $expr)" >"$log" 2>&1; then
    echo "    $label already builds with the recorded hash; unchanged." >&2
    return 0
  fi
  got="$(grep -oE 'got: +sha256-[A-Za-z0-9+/=]+' "$log" | tail -1 | sed 's/.*got: *//')"
  if [ -z "$got" ]; then
    echo "ERROR: no got-sha256 line for $label. Raw log:" >&2; tail -40 "$log" >&2; return 1
  fi
  echo "    $label -> $got" >&2
  printf "%s=%s\n" "$varname" "$got" >> "$PINS"
}

cat > "$WORK/gs.nix" <<EOF
let
  pkgs = import (import $WORK/nixpkgs-locked.nix) { system = "x86_64-linux"; };
  v = import $VERSIONS;
in pkgs.fetchFromGitHub {
  owner = v.gameScanner.owner; repo = v.gameScanner.repo;
  rev = v.gameScanner.rev; hash = pkgs.lib.fakeHash;
}
EOF
get_hash gs "$WORK/gs.nix" GS_HASH

cat > "$WORK/pnpm.nix" <<EOF
let
  pkgs = import (import $WORK/nixpkgs-locked.nix) { system = "x86_64-linux"; };
  v = import $VERSIONS;
in pkgs.fetchPnpmDeps {
  pname = "celemod-ui-deps"; version = v.version;
  src = $REPO_ROOT/src/celemod-ui; pnpm = pkgs.pnpm_11;
  fetcherVersion = v.pnpm.fetcherVersion; hash = pkgs.lib.fakeHash;
}
EOF
get_hash pnpm "$WORK/pnpm.nix" PNPM_HASH

cat > "$WORK/cargo.nix" <<EOF
let
  pkgs = import (import $WORK/nixpkgs-locked.nix) { system = "x86_64-linux"; };
in pkgs.rustPlatform.fetchCargoVendor {
  name = "celemod-cargo-vendor"; src = $REPO_ROOT; hash = pkgs.lib.fakeHash;
}
EOF
get_hash cargo "$WORK/cargo.nix" CARGO_HASH

echo; echo "== resolved pins"; cat "$PINS"

# Rewrite versions.nix deterministically. Values are applied by anchor, and the
# '# got: <hash>' provenance comments are refreshed to match.
python3 - "$VERSIONS" "$PINS" "$DRY_RUN" "$OUT_DIR/rewrite.py" <<PYEOF
import re, sys
vers, pins_file, dry, helper = sys.argv[1], sys.argv[2], sys.argv[3] == '1', None
sys.path.insert(0, __import__('os').path.dirname(sys.argv[4]))
pins = {}
for line in open(pins_file):
    line = line.strip()
    if '=' in line:
        k, v = line.split('=', 1); pins[k] = v
src = open(vers).read()
orig = src

# A valid SRI sha256: 'sha256-' followed by exactly 44 base64 chars ending '='.
SRI_RE = re.compile(r'^sha256-[A-Za-z0-9+/]{43}=$')


def validate(text, where):
    """Every sha256 STRING LITERAL must be a well-formed SRI digest.

    Only double-quoted literals are checked: prose such as got: sha256-...
    inside comments is not a hash and must not trip the guard.

    NOTE the length check is load-bearing. A 43-char digest (one character
    truncated) fails SRI_RE, but a digest that merely had its first few
    base64 chars overwritten -- e.g. sha256-AAAAxbEo...X= instead of
    sha256-xbEo...X4OGQ= -- is still exactly 44 chars and therefore passes a
    purely syntactic SRI check. That is precisely how a corrupt hash once
    reached disk while this validator said OK, so the AAAA prefix of
    lib.fakeHash is rejected explicitly below.
    """
    bad = [h for h in re.findall(r'"(sha256-[^"]*)"', text) if not SRI_RE.match(h)]
    fake = [h for h in re.findall(r'"(sha256-[^"]*)"', text) if h.startswith("sha256-AAAA")]
    if bad:
        raise SystemExit("ERROR: malformed sha256 literal(s) in " + where + ": " + repr(bad))
    if fake:
        raise SystemExit("ERROR: placeholder/fake sha256 literal(s) in " + where + ": " + repr(fake))


def sub_once(text, pattern, repl, what):
    new, n = re.subn(pattern, repl, text, count=1, flags=re.S)
    if n != 1:
        raise SystemExit('ERROR: no anchor for ' + what)
    return new


# Anchor on the ENTIRE quoted literal, quotes included, and replace the whole
# thing. Matching only 'sha256-[^"]+' while substituting a fresh hash is what
# previously left a stray 'AAAA' prefix and truncated the tail by one char.
def set_hash(text, anchor, new_hash, what):
    pattern = anchor + r'"sha256-[A-Za-z0-9+/=]+"'
    return sub_once(text, pattern, lambda m: m.group(1) + '"' + new_hash + '"', what)


if 'GS_HASH' in pins:
    # The '# got:' provenance comment is OPTIONAL: the refresher below strips
    # every one of them, so a mandatory comment group would make this anchor
    # permanently unsatisfiable (ERROR: no anchor for gameScanner.hash).
    src = set_hash(src,
                   r'(rev = "[0-9a-f]{40}";\s*\n\s*(?:# got: sha256-[^\n]*\n\s*)?hash = )',
                   pins['GS_HASH'], 'gameScanner.hash')
if 'PNPM_HASH' in pins:
    src = set_hash(src, r'(depsHash = )', pins['PNPM_HASH'], 'pnpm.depsHash')
if 'CARGO_HASH' in pins:
    src = set_hash(src, r'(cargoHash = )', pins['CARGO_HASH'], 'cargoHash')

for key in ('GS_HASH', 'PNPM_HASH', 'CARGO_HASH'):
    if key in pins:
        h = pins[key]
        src = re.sub(r'(^\s*)# got: sha256-[A-Za-z0-9+/=]+$', lambda m, h=h: m.group(1) + '# got: ' + h, src, flags=re.M)

# Refuse to write anything that is not a well-formed SRI digest set.
validate(src, 'rewritten versions.nix')
if not dry:
    validate(orig, 'current versions.nix')

# SEMANTIC assertion -- the missing half of the guard. validate() above only
# proves a digest is well formed; a hash that is wrong but syntactically
# perfect (e.g. first chars overwritten or copied from the wrong derivation)
# passes it and only fails later, as a hash mismatch inside a fixed-output
# build. Assert instead that every value now IN THE FILE is exactly the value
# this run measured, so 'wrote something plausible' becomes 'wrote what I
# resolved'. This is what would have caught the corrupt writes immediately.
def assert_pinned(text, pins):
    expected = {'cargoHash': pins.get('CARGO_HASH'),
                'depsHash': pins.get('PNPM_HASH'),
                'gameScanner.hash': pins.get('GS_HASH')}
    found = {'cargoHash': re.findall(r'cargoHash = "(sha256-[^"]+)"', text),
             'depsHash': re.findall(r'depsHash = "(sha256-[^"]+)"', text),
             'gameScanner.hash': re.findall(r'rev = "[0-9a-f]{40}";\s*\n\s*(?:# got: sha256-[^\n]*\n\s*)?hash = "(sha256-[^"]+)"', text)}
    for name, want in expected.items():
        if want is None:
            continue
        got = found.get(name) or []
        if len(got) != 1 or got[0] != want:
            raise SystemExit('ERROR: ' + name + ' in the rewritten file is ' + repr(got)
                             + ' but this run measured ' + repr(want))

assert_pinned(src, pins)

if dry:
    print('--dry-run: would write ' + str(len(src)) + ' bytes (all hashes well-formed)')
    sys.exit(0)

import shutil
shutil.copy2(vers, vers + '.bak')
with open(vers, 'w') as fh:
    fh.write(src)

# Post-write verification: a corrupt file must never survive.
check = open(vers).read()
try:
    validate(check, 'versions.nix on disk')
    assert_pinned(check, pins)
except SystemExit as exc:
    shutil.copy2(vers + '.bak', vers)
    raise SystemExit(str(exc) + ' -- RESTORED from ' + vers + '.bak')

# The backup is only a safety net, never an artifact: remove it once the write
# is proven good, so the tree stays clean (a stray versions.nix.bak is noise and
# would be committed by a careless `git add -A`).
import os
os.remove(vers + '.bak')
print('unchanged (already up to date)' if src == orig else 'updated')
PYEOF

echo; echo "== verifying versions.nix still evaluates"
"${NIX[@]}" eval --json --no-write-lock-file --file "$VERSIONS" >/dev/null && echo "eval OK"