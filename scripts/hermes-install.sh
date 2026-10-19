#!/usr/bin/env bash
# Install the job-hunt plugin into Hermes from this checkout (dev install; edits apply on restart).
# Usage: scripts/hermes-install.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_DIR="${HERMES_HOME:-$HOME/.hermes}"

command -v hermes >/dev/null || { echo "hermes not found on PATH" >&2; exit 1; }
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node >= 22.18 not found on PATH" >&2; exit 1; }
"$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' \
  || { echo "node >= 22.18 required (node:sqlite, TypeScript type stripping)" >&2; exit 1; }

mkdir -p "$HERMES_DIR/plugins"
ln -sfn "$ROOT" "$HERMES_DIR/plugins/job-hunt"
hermes plugins enable job-hunt

hermes mcp add job_hunt_tracker --command "$NODE" --args --no-warnings "$ROOT/servers/tracker/src/index.ts"

echo "Done. Restart Hermes, then run /job-hunt:setup"
