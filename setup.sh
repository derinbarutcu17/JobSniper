#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required but was not found in PATH." >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "Installing dependencies..."
npm install

echo "Running typecheck..."
npm run typecheck

echo "Checking CLI help..."
npm run sniper -- help

cat <<'EOF'

Setup complete.

Next steps:
  1. Review config.json
  2. Onboard a profile:
     npm run sniper -- onboard "/absolute/path/to/cv.pdf"
  3. Run a discovery pass:
     npm run sniper -- run
  4. Target student roles:
     npm run sniper -- run --lane student_jobs

Google Sheets is optional. Configure credentials first if you want sync.
EOF
