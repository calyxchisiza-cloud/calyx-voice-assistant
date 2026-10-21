# Verifies that the CALYX desktop shortcut actually opens a window.
#
# Reproduces the two failure modes a user hits:
#   1. Double-clicking the shortcut on a cold start.
#   2. Double-clicking it again while CALYX is already running.
#
# CALYX opens in Edge's app window when Edge is installed (voice needs
# Microsoft's speech service, which Chromium/Electron cannot reach), and falls
# back to Electron otherwise. This script accepts either shell, but insists that
# a VISIBLE window titled CALYX exists and the app is still alive.
#
# Run from the project folder:
#   powershell -ExecutionPolicy Bypass -File scripts\verify-shortcut.ps1

$ErrorActionPreference = 'Stop'

$windowSig = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class CalyxWin {
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RC r);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);

  public struct RC { public int L, T, Rr, B; }

  public static string Find(string needle) {
    var found = new StringBuilder();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowTextW(h, sb, sb.Capacity);
      var title = sb.ToString();
      if (title.IndexOf(needle, StringComparison.OrdinalIgnoreCase) < 0) return true;
      RC rc; GetWindowRect(h, out rc);
      found.Append(title).Append('|').Append(rc.Rr - rc.L).Append('x').Append(rc.B - rc.T);
      return false;
    }, IntPtr.Zero);
    return found.ToString();
  }
}
'@
if (-not ('CalyxWin' -as [type])) { Add-Type $windowSig }

function Get-CalyxWindow {
  # Page title is "CALYX - Synthetic voice console"; the Electron fallback uses
  # "CALYX". Matching on the word CALYX covers both, in either shell.
  $raw = [CalyxWin]::Find('CALYX')
  if (-not $raw) { return $null }
  $parts = $raw -split '\|', 2
  return [PSCustomObject]@{ Title = $parts[0]; Size = $parts[1] }
}

function Invoke-Shortcut {
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\CALYX\CALYX.lnk")
  if (-not (Test-Path $lnk.FullName)) { throw 'Start Menu shortcut is missing. Run scripts\install-shortcuts.ps1 first.' }
  # Launch the shortcut the way Explorer does: wscript.exe with the .vbs path.
  Start-Process -FilePath $lnk.TargetPath -ArgumentList $lnk.Arguments
}

function Get-CalyxProcessCount {
  $shells = @(Get-Process electron, msedge -ErrorAction SilentlyContinue)
  return $shells.Count
}

function Reset-Calyx {
  Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  # Only stop Edge instances serving CALYX, never the user's own browser windows.
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*CALYX*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  # The launcher's plain-node parent (Electron binary run as Node).
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*desktop\launch.js*' -or $_.CommandLine -like '*desktop/launch.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  $holder = Get-NetTCPConnection -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty OwningProcess
  if ($holder) { Stop-Process -Id $holder -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

$results = @()

Write-Host 'Test 1: cold start from the Start Menu shortcut...' -ForegroundColor Cyan
Reset-Calyx
Invoke-Shortcut
Start-Sleep -Seconds 22
$win = Get-CalyxWindow
$alive = Get-CalyxProcessCount
$results += [PSCustomObject]@{
  Test = 'Cold start'
  Title = if ($win) { $win.Title } else { 'NONE' }
  Size = if ($win) { $win.Size } else { '-' }
  Visible = if ($win) { 'YES' } else { 'NO' }
  Procs = $alive
  Pass = [bool]($win -and $alive -gt 0)
}

Write-Host 'Test 2: launch again while already running...' -ForegroundColor Cyan
Invoke-Shortcut
Start-Sleep -Seconds 12
$win2 = Get-CalyxWindow
$alive2 = Get-CalyxProcessCount
$results += [PSCustomObject]@{
  Test = 'Second launch'
  Title = if ($win2) { $win2.Title } else { 'NONE' }
  Size = if ($win2) { $win2.Size } else { '-' }
  Visible = if ($win2) { 'YES' } else { 'NO' }
  Procs = $alive2
  # A window must still exist. Edge spawns a handful of helper processes, so the
  # count is only a sanity check that something is running.
  Pass = [bool]($win2 -and $alive2 -gt 0)
}

Write-Host ''
$results | Format-Table -AutoSize | Out-String -Width 140 | Write-Host

if (($results | Where-Object { -not $_.Pass }).Count -eq 0) {
  Write-Host 'PASS - the shortcut opens a visible CALYX window in both cases.' -ForegroundColor Green
  exit 0
}

Write-Host 'FAIL - see the table above.' -ForegroundColor Red
exit 1
