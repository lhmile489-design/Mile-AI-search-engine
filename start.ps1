# Mile AI Search one-click launcher (Windows PowerShell)
# Single process: the backend serves the exported frontend on one port.
# Usage: .\start.ps1             start on port 8000
#        .\start.ps1 -Rebuild    force rebuild of the frontend
# Env:   $env:PORT = "8000" to change the port
param([switch]$Rebuild)

$ErrorActionPreference = "Stop"
$port = if ($env:PORT) { $env:PORT } else { "8000" }
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

foreach ($cmd in @("uv", "node", "npm")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "Missing required tool: $cmd. See README.md (Requirements)." -ForegroundColor Red
        exit 1
    }
}

$envFile = Join-Path $backend ".env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $backend ".env.example") $envFile
    Write-Host "Created backend\.env. Fill in LLM_API_KEY and TAVILY_API_KEY, then run this script again." -ForegroundColor Yellow
    exit 1
}

Write-Host "[1/3] Installing backend dependencies..."
Push-Location $backend
uv sync
Pop-Location

Write-Host "[2/3] Building frontend (static export)..."
Push-Location $frontend
if (-not (Test-Path "node_modules")) { npm ci }
if ($Rebuild -or -not (Test-Path "out\index.html")) { $env:STATIC_EXPORT = "1"; npm run build }
Pop-Location

Write-Host "[3/3] Starting..."
Write-Host "Open http://localhost:$port  (Ctrl+C to stop)" -ForegroundColor Green
Push-Location $backend
uv run uvicorn app.main:app --host 127.0.0.1 --port $port
Pop-Location
