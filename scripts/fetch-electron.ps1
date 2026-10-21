# Downloads the Electron runtime if a package manager skipped it.
#
# pnpm blocks dependency install scripts by default, which leaves Electron
# without its binary (node_modules/electron/dist). This script fetches it
# directly so "pnpm desktop" works.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\fetch-electron.ps1

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = Split-Path -Parent $PSScriptRoot

# Locate the installed electron package (pnpm stores it under .pnpm).
$electronDir = Get-ChildItem (Join-Path $projectRoot 'node_modules\.pnpm') -Directory -Filter 'electron@*' -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $electronDir) {
    throw "Electron is not installed. Run 'pnpm install' in $projectRoot first."
}

$pkgDir = Join-Path $electronDir.FullName 'node_modules\electron'
$distDir = Join-Path $pkgDir 'dist'

if (Test-Path (Join-Path $distDir 'electron.exe')) {
    Write-Host 'Electron runtime already present.' -ForegroundColor Green
    exit 0
}

$version = (Get-Content (Join-Path $pkgDir 'package.json') -Raw | ConvertFrom-Json).version
$zip = Join-Path $env:TEMP "electron-$version-win32-x64.zip"

$urls = @(
    "https://npmmirror.com/mirrors/electron/$version/electron-v$version-win32-x64.zip",
    "https://github.com/electron/electron/releases/download/v$version/electron-v$version-win32-x64.zip"
)

$downloaded = $false
foreach ($url in $urls) {
    try {
        Write-Host "Downloading Electron $version..."
        Write-Host "  from $url"
        Invoke-WebRequest -Uri $url -OutFile $zip -TimeoutSec 1800 -UseBasicParsing
        if ((Get-Item $zip).Length -gt 50MB) { $downloaded = $true; break }
    } catch {
        Write-Host "  failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

if (-not $downloaded) {
    throw "Could not download the Electron runtime from any mirror."
}

Write-Host "Extracting..."
$staging = Join-Path $env:TEMP "electron-extract-$version"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $staging -Force

if (Test-Path $distDir) { Remove-Item $distDir -Recurse -Force }
Move-Item -Path $staging -Destination $distDir
Remove-Item $zip -Force -ErrorAction SilentlyContinue

# Electron's own version marker, expected by its launcher.
Set-Content -Path (Join-Path $distDir 'version') -Value $version -Encoding ASCII

if (Test-Path (Join-Path $distDir 'electron.exe')) {
    Write-Host 'Electron runtime installed successfully.' -ForegroundColor Green
} else {
    throw 'Extraction finished but electron.exe is missing.'
}
