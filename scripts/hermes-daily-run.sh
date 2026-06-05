#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

TIMEOUT_SECS="${SNIPER_DAILY_TIMEOUT:-300}"

run_with_timeout() {
  local secs="$1"
  timeout "$secs" npm run sniper -- daily
}

run_with_timeout "$TIMEOUT_SECS"
