#!/usr/bin/env bash
# One-click build for AI Hub Desktop on macOS and Linux.
#
#   ./BUILD.sh              # installer for this OS
#   ./BUILD.sh --dir        # unpacked build, no installer
#   ./BUILD.sh --fast       # skip lint + tests
#
# Installs dependencies and the Electron runtime when missing, refreshes the
# cached service catalogue, runs the checks, then builds into dist/.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[FAIL] Node.js 20+ is required. Install it from https://nodejs.org" >&2
  exit 1
fi

exec node scripts/one-click-build.js "$@"
