#!/bin/bash
# Installs the official Node.js LTS from nodejs.org for the job-hunt plugin (macOS).
# Downloads the .pkg, checks its SHA-256 and Gatekeeper's verdict on it (signed by the Node.js Foundation
# and notarized by Apple), then opens Apple's installer for the user to click through. Never runs sudo.
#
#   install-node.sh            download, verify, open the installer (does nothing if Node 22.18+ is there)
#   install-node.sh --check    exit 0 if Node 22.18+ (23.4+ on 23.x) is the one the plugin will use,
#                              1 if Node is missing or too old, 3 if an older Node first on PATH hides a newer one
#   install-node.sh --dry-run  download and verify the checksum, open nothing
#
# Install and dry-run modes exit 0 when Node is fine or the installer was opened, else 2 (including the
# shadowed case, without downloading: installing the LTS would not fix it). They are macOS only.
#
# Node is looked for first on PATH, then in /usr/local/bin and /opt/homebrew/bin.
#
# Env (for tests):
#   JOB_TRACKER_NODE_DIST     download base (default https://nodejs.org/dist); when set, the macOS-only check is
#                          skipped too (test fixture mode)
#   JOB_TRACKER_NODE          use this binary instead of the PATH lookup; when set without JOB_TRACKER_NODE_DEFAULT,
#                          no default locations are checked at all
#   JOB_TRACKER_NODE_DEFAULT  use this binary instead of the default install locations
set -euo pipefail

DIST="${JOB_TRACKER_NODE_DIST:-https://nodejs.org/dist}"
SIGNER="Developer ID Installer: Node.js Foundation (HX7739G8FX)"
MODE="${1:-}"

fail() { echo "$1" >&2; exit 2; }

# Succeeds if the version string supports this plugin: 22.18+, 23.4+ or 24+.
new_enough() {
  local major minor
  IFS=. read -r major minor _ <<< "${1#v}"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || return 1
  [ "$major" -ge 24 ] || { [ "$major" -eq 23 ] && [ "$minor" -ge 4 ]; } || { [ "$major" -eq 22 ] && [ "$minor" -ge 18 ]; }
}

# Prints one line about the Node the plugin would use. Returns 0 if it is new enough, 1 if Node is missing
# or too old (installing the LTS fixes that), 3 if a new enough Node is shadowed by an older one on PATH.
check() {
  local first first_v="" c v older
  if [ -n "${JOB_TRACKER_NODE:-}" ]; then first="$JOB_TRACKER_NODE"; else first="$(command -v node || true)"; fi
  if [ -n "$first" ] && [ -x "$first" ]; then
    first_v="$("$first" --version 2>/dev/null || true)"
    if new_enough "$first_v"; then echo "Node.js $first_v is installed at $first."; return 0; fi
  else
    first=""
  fi
  if [ -n "${JOB_TRACKER_NODE_DEFAULT:-}" ]; then set -- "$JOB_TRACKER_NODE_DEFAULT"
  elif [ -n "${JOB_TRACKER_NODE:-}" ]; then set --
  else set -- /usr/local/bin/node /opt/homebrew/bin/node
  fi
  for c in "$@"; do
    [ "$c" != "$first" ] && [ -x "$c" ] || continue
    v="$("$c" --version 2>/dev/null || true)"
    new_enough "$v" || continue
    if [ -z "$first" ]; then
      echo "Node.js $v is installed at $c (not on PATH yet; reopening the app usually fixes that)."
      return 0
    fi
    if [ -n "$first_v" ]; then older="$first_v at $first"; else older="$first, which did not run"; fi
    echo "Node.js $v is installed at $c, but an older Node.js ($older) comes first on PATH and the plugin would use that one. Remove or update the older one, then reopen the app."
    return 3
  done
  if [ -z "$first" ]; then echo "Node.js is not installed."
  elif [ -z "$first_v" ]; then echo "Node.js at $first did not run."
  else echo "Node.js $first_v at $first is too old; the plugin needs 22.18 or newer (23.x needs 23.4 or newer)."
  fi
  return 1
}

case "$MODE" in
  --check) status=0; check || status=$?; exit "$status" ;;
  --dry-run | "") ;;
  *) fail "Unknown option $MODE. Use --check or --dry-run." ;;
esac

# Running it twice, or on a machine that already has Node, must not install anything.
status=0
installed="$(check)" || status=$?
case "$status" in
  0) echo "$installed Nothing to install."; exit 0 ;;
  1) echo "$installed" ;;
  *) fail "$installed" ;;
esac
# The .pkg is macOS only. JOB_TRACKER_NODE_DIST (test fixture mode) skips this so the tests run on any OS.
[ -n "${JOB_TRACKER_NODE_DIST:-}" ] || [ "$(uname)" = Darwin ] \
  || fail "This installer is for macOS. On Linux, install Node.js 22.18 or newer with your package manager or from https://nodejs.org/en/download."
echo "Installing the current LTS."

tmp="$(mktemp -d "${TMPDIR:-/tmp}/jh-node.XXXXXX")" || fail "Could not create a temporary folder. Nothing was installed."
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$DIST/index.tab" -o "$tmp/index.tab" 2>/dev/null \
  || fail "Could not reach $DIST. Check the internet connection and try again."
version="$(awk -F'\t' 'NR > 1 && NF >= 10 && $10 != "-" { print $1; exit }' "$tmp/index.tab")"
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Could not find a Node.js LTS release in $DIST/index.tab."

pkg="node-$version.pkg"
echo "Downloading Node.js $version (LTS) from $DIST ..."
echo "This is about 90 MB and can take a few minutes."
curl -fsSL "$DIST/$version/$pkg" -o "$tmp/$pkg" 2>/dev/null || fail "Download of $pkg failed. Nothing was installed."
curl -fsSL "$DIST/$version/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt" 2>/dev/null || fail "Download of the checksums failed. Nothing was installed."
want="$(awk -v f="$pkg" '$2 == f { print $1 }' "$tmp/SHASUMS256.txt")"
got="$(shasum -a 256 "$tmp/$pkg" | awk '{ print $1 }')" || fail "Could not compute the checksum of $pkg. Nothing was installed."
if [ -z "$want" ] || [ "$want" != "$got" ]; then fail "Checksum mismatch for $pkg. Nothing was installed."; fi
echo "Checksum ok."

if [ "$MODE" = "--dry-run" ]; then
  echo "Dry run: would check the signature and open $tmp/$pkg"
  exit 0
fi

# Gatekeeper must accept it as notarized, and the signer must be exactly the Node.js Foundation's certificate.
unsigned="$pkg is not signed and notarized by the Node.js Foundation. Nothing was installed."
a="$(spctl --assess --type install -vv "$tmp/$pkg" 2>&1)" || fail "$unsigned"
printf '%s\n' "$a" | grep -qxF "origin=$SIGNER" || fail "$unsigned"
printf '%s\n' "$a" | grep -qxF 'source=Notarized Developer ID' || fail "$unsigned"

open "$tmp/$pkg" || fail "Could not open the installer. Nothing was installed."
trap - EXIT  # the .pkg must survive while Apple's installer has it open
echo "The Node.js installer is open. Click through it (it asks for your Mac password in Apple's own window), then come back and say done."
