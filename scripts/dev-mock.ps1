# Run from any directory: powershell -ExecutionPolicy Bypass -File scripts/dev-mock.ps1
# Stop the frontend with Ctrl+C; backend services stay running.
[CmdletBinding()]
param([switch]$BackendOnly, [switch]$Stop)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot 'docker-compose.mock.yml'
$previousComposeSetting = $env:COMPOSE_DISABLE_ENV_FILE
$previousApiBase = $env:VITE_API_BASE_URL

try {
    $env:COMPOSE_DISABLE_ENV_FILE = '1'
    $env:VITE_API_BASE_URL = ''
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker is missing. Install Docker Desktop before using this helper.'
    }
    $dockerOsType = & docker info --format '{{.OSType}}'
    if ($LASTEXITCODE -ne 0) {
        throw 'Start Docker Desktop and wait until its Linux engine is running, then retry.'
    }
    if ($dockerOsType -ne 'linux') {
        throw 'Switch Docker Desktop to Linux containers, then retry.'
    }
    if (-not $BackendOnly -and -not $Stop) {
        if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
            throw 'Node.js/npm is missing. Install compatible Node.js to start the UI.'
        }
        if (-not (Test-Path (Join-Path $projectRoot 'platform_app/vite.mock.config.ts') -PathType Leaf)) {
            throw 'The frontend mock configuration is missing: platform_app/vite.mock.config.ts.'
        }
    }
    if ($Stop) {
        & docker compose --env-file NUL -p midas-dash-mock -f $composeFile down
        if ($LASTEXITCODE -ne 0) { throw 'Could not stop mock backend services.' }
        return
    }
    & docker compose --env-file NUL -p midas-dash-mock -f $composeFile up --build -d --wait --wait-timeout 180
    if ($LASTEXITCODE -ne 0) { throw 'Mock backend startup failed. Inspect docker compose logs.' }
    if ($BackendOnly) { return }

    Push-Location (Join-Path $projectRoot 'platform_app')
    try {
        if (-not (Test-Path 'node_modules/.bin/vite.cmd')) {
            & npm.cmd ci
            if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
        }
        Write-Host 'Mock UI: http://127.0.0.1:5173 (Ctrl+C stops UI; use -Stop to stop backend).'
        & npm.cmd run dev -- --config vite.mock.config.ts --mode mock
        if ($LASTEXITCODE -ne 0) { throw 'Frontend exited with an error.' }
    } finally {
        Pop-Location
    }
} finally {
    $env:COMPOSE_DISABLE_ENV_FILE = $previousComposeSetting
    $env:VITE_API_BASE_URL = $previousApiBase
}
