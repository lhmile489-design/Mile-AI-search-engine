#!/usr/bin/env bash
# Mile AI Search one-click launcher (macOS / Linux / Git Bash)
# Single process: the backend serves the exported frontend on one port.
# Usage: ./start.sh            start on port 8000
#        ./start.sh --rebuild  force rebuild of the frontend
# Env:   PORT=8000 to change the port
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REBUILD="${1:-}"
PORT="${PORT:-8000}"

for cmd in uv node npm; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing required tool: $cmd. See README.md (Requirements)."; exit 1; }
done

if [ ! -f "$ROOT/backend/.env" ]; then
  cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
  echo "Created backend/.env. Fill in LLM_API_KEY and TAVILY_API_KEY, then run this script again."
  exit 1
fi

echo "[1/3] Installing backend dependencies..."
(cd "$ROOT/backend" && uv sync)

echo "[2/3] Building frontend (static export)..."
cd "$ROOT/frontend"
[ -d node_modules ] || npm ci
if [ "$REBUILD" = "--rebuild" ] || [ ! -f out/index.html ]; then STATIC_EXPORT=1 npm run build; fi

echo "[3/3] Starting..."
echo "Open http://localhost:$PORT  (Ctrl+C to stop)"
cd "$ROOT/backend"
exec uv run uvicorn app.main:app --host 127.0.0.1 --port "$PORT"
