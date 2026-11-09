#!/usr/bin/env bash
# Mile AI Search one-click launcher (macOS / Linux / Git Bash)
# Usage: ./start.sh            start backend (8000) and frontend (3000)
#        ./start.sh --rebuild  force rebuild of the frontend
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REBUILD="${1:-}"

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

echo "[2/3] Installing and building frontend..."
cd "$ROOT/frontend"
[ -d node_modules ] || npm ci
if [ "$REBUILD" = "--rebuild" ] || [ ! -f .next/BUILD_ID ]; then npm run build; fi

echo "[3/3] Starting services..."
(cd "$ROOT/backend" && exec uv run uvicorn app.main:app --host 127.0.0.1 --port 8000) &
BE_PID=$!
trap 'kill "$BE_PID" 2>/dev/null || true' EXIT INT TERM
sleep 3
echo "Open http://localhost:3000  (Ctrl+C to stop both services)"
npm run start
