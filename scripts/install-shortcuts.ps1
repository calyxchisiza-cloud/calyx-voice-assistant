# CALYX — desktop shortcut installer.
#
# Run this ONCE. It creates a "CALYX" shortcut on the Desktop and in the Start
# Menu that launches the app with no terminal window.
#
# Usage (from the project folder):
#   powershell -ExecutionPolicy Bypass -File scripts\install-shortcuts.ps1
#
# Optional: -StartWithWindows also registers CALYX to launch at login.

param(
    [switch]$StartWithWindows
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $projectRoot 'CALYX.vbs'
$iconPath = Join-Path $projectRoot 'build\icon.ico'
$electronExe = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'

$launchEntry = Join-Path $projectRoot 'desktop\launch.js'

if (-not (Test-Path $launcher)) {
    throw "Launcher not found: $launcher"
}
if (-not (Test-Path $launchEntry)) {
    throw "Launcher entry not found: $launchEntry"
}
if (-not (Test-Path $electronExe)) {
    throw "The bundled runtime is missing. Run 'pnpm install' in $projectRoot first."
}
if (-not (Test-Path (Join-Path $projectRoot '.next'))) {
    throw "No production build found. Run 'pnpm build' in $projectRoot first."
}

$shell = New-Object -ComObject WScript.Shell

function New-CalyxShortcut {
    param([string]$Path)
    $shortcut = $shell.CreateShortcut($Path)
    # wscript.exe runs the .vbs launcher, which starts the app with no console.
    # The launcher itself picks the window shell (Edge preferred, Electron fallback).
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
    $shortcut.Arguments = "`"$launcher`""
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.Description = 'CALYX — voice-first PC assistant'
    if (Test-Path $iconPath) { $shortcut.IconLocation = "$iconPath,0" }
    $shortcut.Save()
}

$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'CALYX'

New-CalyxShortcut -Path (Join-Path $desktop 'CALYX.lnk')

if (-not (Test-Path $startMenu)) { New-Item -ItemType Directory -Path $startMenu | Out-Null }
New-CalyxShortcut -Path (Join-Path $startMenu 'CALYX.lnk')

$created = @(
    (Join-Path $desktop 'CALYX.lnk'),
    (Join-Path $startMenu 'CALYX.lnk')
)

if ($StartWithWindows) {
    $startup = [Environment]::GetFolderPath('Startup')
    New-CalyxShortcut -Path (Join-Path $startup 'CALYX.lnk')
    $created += (Join-Path $startup 'CALYX.lnk')
}

Write-Host ''
Write-Host 'CALYX shortcuts created:' -ForegroundColor Cyan
$created | ForEach-Object { Write-Host "  $_" }
Write-Host ''
Write-Host 'Double-click the CALYX icon on your Desktop to start it.' -ForegroundColor Green
Write-Host 'No terminal is needed.'
