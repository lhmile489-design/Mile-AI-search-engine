# Mile AI Search one-click launcher (Windows PowerShell)
# Usage: .\start.ps1            start backend (8000) and frontend (3000)
#        .\start.ps1 -Rebuild   force rebuild of the frontend
param([switch]$Rebuild)

$ErrorActionPreference = "Stop"
$bePort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "8000" }
$fePort = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "3000" }
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

Write-Host "[2/3] Installing and building frontend..."
Push-Location $frontend
if (-not (Test-Path "node_modules")) { npm ci }
if ($Rebuild -or -not (Test-Path ".next\BUILD_ID")) { $env:BACKEND_ORIGIN = "http://127.0.0.1:$bePort"; npm run build }
Pop-Location

Write-Host "[3/3] Starting services..."
$be = Start-Process -FilePath "uv" -ArgumentList @("run", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", $bePort) -WorkingDirectory $backend -PassThru -NoNewWindow
try {
    Start-Sleep -Seconds 3
    Write-Host "Open http://localhost:$fePort  (Ctrl+C to stop both services)" -ForegroundColor Green
    Push-Location $frontend
    npm run start -- -p $fePort
    Pop-Location
}
finally {
    if ($be -and -not $be.HasExited) { taskkill /PID $be.Id /T /F | Out-Null }
}
