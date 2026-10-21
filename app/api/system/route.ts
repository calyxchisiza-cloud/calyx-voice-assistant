import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import nodemailer from 'nodemailer';
import { APP_ALIASES, FOLDER_ALIASES, isBlockedCommand, type SystemRequest, type SystemResponse } from '@/lib/system';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const requestLog = new Map<string, number[]>();

/** App id -> launch target. This list is the security boundary. */
const APP_COMMANDS: Record<string, string> = {
  notepad: 'notepad.exe',
  calculator: 'calc.exe',
  paint: 'mspaint.exe',
  explorer: 'explorer.exe',
  settings: 'ms-settings:',
  taskmanager: 'taskmgr.exe',
  camera: 'microsoft.windows.camera:',
  snippingtool: 'ms-screenclip:',
  controlpanel: 'control.exe',
  cmd: 'cmd.exe',
  terminal: 'wt.exe',
  powershell: 'powershell.exe',
  word: 'winword',
  excel: 'excel',
  powerpoint: 'powerpnt',
  outlook: 'outlook',
  spotify: 'spotify.exe',
  vscode: 'code',
  chrome: 'chrome',
  edge: 'msedge',
  firefox: 'firefox',
  steam: 'steam://open/main',
  discord: 'discord://',
  whatsapp: 'whatsapp:',
  telegram: 'tg://',
  clock: 'ms-clock:',
  mail: 'outlookmail:',
  store: 'ms-windows-store:',
  'installed apps': 'ms-settings:appsfeatures',
  uninstall: 'ms-settings:appsfeatures',
  updates: 'ms-settings:windowsupdate',
  storage: 'ms-settings:storagesense',
  display: 'ms-settings:display',
  sound: 'ms-settings:sound',
  bluetooth: 'ms-settings:bluetooth',
  'default apps': 'ms-settings:defaultapps',
  startup: 'ms-settings:startupapps',
};

/** App id -> process names, for gracefully closing an app. */
const APP_PROCESSES: Record<string, string[]> = {
  notepad: ['notepad'],
  calculator: ['CalculatorApp', 'Calculator', 'calc'],
  paint: ['mspaint'],
  explorer: ['explorer'],
  settings: ['SystemSettings'],
  taskmanager: ['Taskmgr'],
  camera: ['WindowsCamera'],
  snippingtool: ['SnippingTool', 'ScreenSketch'],
  controlpanel: ['Control'],
  cmd: ['cmd'],
  terminal: ['WindowsTerminal', 'wt'],
  powershell: ['powershell', 'pwsh'],
  word: ['WINWORD'],
  excel: ['EXCEL'],
  powerpoint: ['POWERPNT'],
  outlook: ['OUTLOOK'],
  spotify: ['Spotify'],
  vscode: ['Code'],
  chrome: ['chrome'],
  edge: ['msedge'],
  firefox: ['firefox'],
  steam: ['steam'],
  discord: ['Discord'],
  whatsapp: ['WhatsApp'],
  telegram: ['Telegram'],
  clock: ['Time'],
  mail: ['HxOutlook', 'olk'],
  store: ['WinStore.App', 'Microsoft.WindowsStore'],
  'installed apps': ['SystemSettings'],
  uninstall: ['SystemSettings'],
  updates: ['SystemSettings'],
  storage: ['SystemSettings'],
  display: ['SystemSettings'],
  sound: ['SystemSettings'],
  bluetooth: ['SystemSettings'],
  'default apps': ['SystemSettings'],
  startup: ['SystemSettings'],
};

/** Folder id -> path relative to the user profile. */
const FOLDER_PATHS: Record<string, string> = {
  downloads: 'Downloads',
  documents: 'Documents',
  desktop: 'Desktop',
  pictures: 'Pictures',
  music: 'Music',
  videos: 'Videos',
  home: '',
  temp: 'AppData\\Local\\Temp',
};

const APP_LABELS: Record<string, string> = Object.fromEntries(Object.values(APP_ALIASES).map((entry) => [entry.id, entry.label]));
const FOLDER_LABELS: Record<string, string> = Object.fromEntries(Object.values(FOLDER_ALIASES).map((entry) => [entry.id, entry.label]));

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, reply: message } satisfies SystemResponse, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * System control only accepts requests made from this machine. The dev server
 * is also bound to 127.0.0.1, so nothing on the LAN can reach it.
 */
function localRequest(request: NextRequest) {
  const host = (request.headers.get('host') || '').split(':')[0].toLowerCase();
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  if (!localHosts.has(host)) return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const originHost = new URL(origin).hostname.toLowerCase();
    return localHosts.has(originHost) && originHost === host;
  } catch {
    return false;
  }
}

async function runPowerShell(script: string) {
  const prefixed = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${script}`;
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', prefixed],
    { timeout: 25_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
  );
  return stdout.trim();
}

/** Values are passed as base64 JSON, never interpolated into the script. */
function payload(value: unknown) {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  return `$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json;`;
}

function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function openApp(app: string): Promise<SystemResponse> {
  const command = APP_COMMANDS[app];
  const label = APP_LABELS[app] || app;
  if (command) {
    try {
      await runPowerShell(`${payload({ command })} Start-Process -FilePath $payload.command;`);
      return { ok: true, reply: `Opening ${label}.` };
    } catch (error) {
      return { ok: false, reply: `That system action failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  // Try launching by name directly as a last resort (allows opening apps not in the hardcoded list).
  const appName = String(app);
  try {
    await runPowerShell(`${payload({ appName })} try { Start-Process -FilePath $payload.appName -ErrorAction Stop } catch { try { Start-Process -FilePath ("$env:LOCALAPPDATA\\Microsoft\\WindowsApps\\" + $payload.appName + ".exe") -ErrorAction Stop } catch { try { Start-Process -FilePath ("$env:ProgramFiles\\" + $payload.appName + "\\" + $payload.appName + ".exe") -ErrorAction SilentlyContinue } catch {}; Start-Process "shell:AppsFolder" -ErrorAction SilentlyContinue } }`);
    return { ok: true, reply: `Opening ${label}.` };
  } catch (error) {
    return { ok: false, reply: `I do not have a launch command for ${label}.` };
  }
}

async function openFolder(folder: string): Promise<SystemResponse> {
  const relative = FOLDER_PATHS[folder];
  const label = FOLDER_LABELS[folder] || folder;
  if (relative === undefined) return { ok: false, reply: 'That folder is not in my allowlist.' };
  await runPowerShell(`${payload({ relative })} $path = Join-Path $env:USERPROFILE $payload.relative; if (-not (Test-Path -LiteralPath $path)) { throw 'Folder not found' }; Start-Process -FilePath explorer.exe -ArgumentList $path;`);
  return { ok: true, reply: `Opening ${label}.` };
}

async function systemInfo(): Promise<SystemResponse> {
  const output = await runPowerShell(`
$os = Get-CimInstance Win32_OperatingSystem
$average = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$cpu = 0
if ($null -ne $average) { $cpu = [math]::Round($average) }
$disk = Get-PSDrive -Name C
$battery = -1
$batteryItem = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if ($batteryItem) { $battery = [math]::Round($batteryItem.EstimatedChargeRemaining) }
$uptime = (Get-Date) - $os.LastBootUpTime
[pscustomobject]@{
  ok = $true
  cpu = $cpu
  ramTotal = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  ramFree = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
  diskFree = [math]::Round($disk.Free / 1GB, 1)
  diskTotal = [math]::Round(($disk.Free + $disk.Used) / 1GB, 1)
  battery = $battery
  os = $os.Caption
  uptimeHours = [math]::Round($uptime.TotalHours, 1)
} | ConvertTo-Json -Compress
`);
  const data = parseJson(output);
  if (!data) return { ok: false, reply: 'I could not read the system information.' };

  const parts = [`CPU is at ${data.cpu} percent.`];
  parts.push(`Memory: ${data.ramFree} of ${data.ramTotal} gigabytes free.`);
  parts.push(`C drive: ${data.diskFree} of ${data.diskTotal} gigabytes free.`);
  if (typeof data.battery === 'number' && data.battery >= 0) parts.push(`Battery is at ${data.battery} percent.`);
  parts.push(`${String(data.os).replace(/\s+/g, ' ')}, up for ${data.uptimeHours} hours.`);
  return { ok: true, reply: parts.join(' ') };
}

const AUDIO_TYPE = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int NotImpl1();
  int NotImpl2();
  int GetChannelCount(out uint channelCount);
  int SetMasterVolumeLevel(float level, Guid eventContext);
  int SetMasterVolumeLevelScalar(float level, Guid eventContext);
  int GetMasterVolumeLevel(out float level);
  int GetMasterVolumeLevelScalar(out float level);
  int NotImpl3();
  int NotImpl4();
  int NotImpl5();
  int NotImpl6();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid eventContext);
  int GetMute(out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int clsCtx, IntPtr activationParams, out IAudioEndpointVolume aev);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int NotImpl1();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }
public class CalyxAudio {
  static IAudioEndpointVolume Volume() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice device = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
    IAudioEndpointVolume volume = null;
    var iid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out volume));
    return volume;
  }
  public static float Get() { float level; Volume().GetMasterVolumeLevelScalar(out level); return level; }
  public static void Set(float level) { Volume().SetMasterVolumeLevelScalar(level, Guid.Empty); }
  public static bool GetMute() { bool muted; Volume().GetMute(out muted); return muted; }
  public static void SetMute(bool muted) { Volume().SetMute(muted, Guid.Empty); }
}
'@`;

async function changeVolume(direction: 'up' | 'down' | 'mute' | 'unmute', steps: number): Promise<SystemResponse> {
  const safeSteps = Math.max(1, Math.min(25, Math.round(steps || 1)));
  const output = await runPowerShell(`${AUDIO_TYPE}
${payload({ direction, steps: safeSteps })}
$direction = $payload.direction
$stepSize = 0.02 * $payload.steps
$level = [CalyxAudio]::Get()
if ($direction -eq 'up') { $level = [Math]::Min(1.0, $level + $stepSize) }
if ($direction -eq 'down') { $level = [Math]::Max(0.0, $level - $stepSize) }
if ($direction -eq 'up' -or $direction -eq 'down') { [CalyxAudio]::Set([float]$level) }
if ($direction -eq 'mute') { [CalyxAudio]::SetMute($true) }
if ($direction -eq 'unmute') { [CalyxAudio]::SetMute($false) }
$now = [math]::Round([CalyxAudio]::Get() * 100)
$muted = [CalyxAudio]::GetMute()
[pscustomobject]@{ ok = $true; volume = $now; muted = $muted } | ConvertTo-Json -Compress
`);
  const data = parseJson(output);
  if (!data) return { ok: false, reply: 'I could not read the volume.' };
  if (direction === 'mute') return { ok: true, reply: 'Muted.' };
  if (direction === 'unmute') return { ok: true, reply: data.muted ? 'It is still muted.' : `Unmuted. Volume is at ${data.volume} percent.` };
  return { ok: true, reply: `Volume is now ${data.volume} percent.` };
}

async function setVolume(level: number): Promise<SystemResponse> {
  const clamped = Math.max(0, Math.min(100, Math.round(level)));
  const output = await runPowerShell(`${AUDIO_TYPE}
${payload({ level: clamped })}
[CalyxAudio]::Set([float]($payload.level / 100))
$now = [math]::Round([CalyxAudio]::Get() * 100)
[pscustomobject]@{ ok = $true; volume = $now } | ConvertTo-Json -Compress
`);
  const data = parseJson(output);
  return { ok: true, reply: `Volume set to ${data?.volume ?? clamped} percent.` };
}

async function screenshot(): Promise<SystemResponse> {
  const output = await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$directory = Join-Path $env:USERPROFILE 'Pictures\\CALYX\\Screenshots'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$path = Join-Path $directory ('screenshot-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.png')
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
$bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Invoke-Item $path
[pscustomobject]@{ ok = $true; path = $path } | ConvertTo-Json -Compress
`);
  const data = parseJson(output);
  if (!data?.path) return { ok: false, reply: 'The screenshot could not be saved.' };
  return { ok: true, reply: 'Screenshot captured and opened.', paths: [String(data.path)] };
}

async function lockPc(): Promise<SystemResponse> {
  await runPowerShell("rundll32.exe user32.dll,LockWorkStation;");
  return { ok: true, reply: 'Locking the PC.' };
}

const SEARCH_FOLDERS: Record<string, string> = {
  downloads: 'Downloads',
  documents: 'Documents',
  desktop: 'Desktop',
};

/** Read-only lookup used by both "find my file" and the delete confirmation. */
async function findFiles(query: string, folder?: 'downloads' | 'documents' | 'desktop'): Promise<string[]> {
  const clean = query.trim().slice(0, 80);
  if (!clean) return [];
  const relative = folder ? SEARCH_FOLDERS[folder] : '';
  const output = await runPowerShell(`${payload({ clean, relative })}
$roots = @()
if ($payload.relative) {
  $roots = @((Join-Path $env:USERPROFILE $payload.relative))
} else {
  $roots = @(
    (Join-Path $env:USERPROFILE 'Desktop'),
    (Join-Path $env:USERPROFILE 'Documents'),
    (Join-Path $env:USERPROFILE 'Downloads')
  )
}
$pattern = '*' + $payload.clean + '*'
$found = @()
foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  $exact = @(Get-ChildItem -LiteralPath $root -Recurse -Depth 4 -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ieq $payload.clean } |
    Select-Object -First 5 -ExpandProperty FullName)
  $found += $exact
  if ($exact.Count -eq 0) {
    $found += Get-ChildItem -LiteralPath $root -Recurse -Depth 4 -Filter $pattern -File -ErrorAction SilentlyContinue |
      Select-Object -First 5 -ExpandProperty FullName
  }
}
$found = @($found | Select-Object -First 8)
[pscustomobject]@{ ok = $true; paths = $found } | ConvertTo-Json -Compress
`);
  const data = parseJson(output);
  return Array.isArray(data?.paths) ? (data.paths as string[]) : [];
}

async function searchFiles(query: string, folder?: 'downloads' | 'documents' | 'desktop'): Promise<SystemResponse> {
  const clean = query.trim().slice(0, 80);
  if (!clean) return { ok: false, reply: 'What file name should I look for?' };
  const paths = await findFiles(clean, folder);
  if (paths.length === 0) return { ok: false, reply: `I could not find a file matching ${clean} in ${folder ? SEARCH_FOLDERS[folder] : 'Desktop, Documents, or Downloads'}.` };
  const names = paths.slice(0, 3).map((path) => path.split('\\').pop() || path);
  const extra = paths.length > 3 ? ` and ${paths.length - 3} more` : '';
  return { ok: true, reply: `I found ${names.join(', ')}${extra}.`, paths };
}

async function deleteFile(path: string): Promise<SystemResponse> {
  if (!path || path.length > 500) return { ok: false, reply: 'That file path is not valid.' };
  const output = await runPowerShell(`${payload({ path })}
Add-Type -AssemblyName Microsoft.VisualBasic
$full = [IO.Path]::GetFullPath($payload.path)
$roots = @(
  [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Desktop')),
  [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents')),
  [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Downloads'))
)
$allowed = $false
foreach ($root in $roots) {
  if ($full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { $allowed = $true; break }
}
if (-not $allowed) { throw 'I can only delete files inside Desktop, Documents or Downloads.' }
if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw 'That file no longer exists.' }
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
  $full,
  [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
  [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
)
[pscustomobject]@{ ok = $true; path = $full } | ConvertTo-Json -Compress
`);
  const data = parseJson(output);
  const name = String(data?.path || path).split('\\').pop();
  return { ok: true, reply: `Deleted ${name}. It is in the Recycle Bin.` };
}

async function closeApp(app: string): Promise<SystemResponse> {
  const names = APP_PROCESSES[app];
  const label = APP_LABELS[app] || app;
  if (!names) return { ok: false, reply: `I do not have a close action for ${label}.` };
  const output = await runPowerShell(`${payload({ names })}
$closed = @()
foreach ($name in $payload.names) {
  Get-Process -Name $name -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    ForEach-Object {
      [void]$_.CloseMainWindow()
      $closed += $_.ProcessName
    }
}
$still = @()
foreach ($name in $payload.names) {
  $deadline = (Get-Date).AddSeconds(3)
  while ((Get-Date) -lt $deadline) {
    $left = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
    if (-not $left) { break }
    Start-Sleep -Milliseconds 250
  }
  $left = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
  if ($left) { $still += $name }
}
[pscustomobject]@{
  ok = $true
  closed = @($closed | Select-Object -Unique)
  still = @($still | Select-Object -Unique)
} | ConvertTo-Json -Compress
`);
  const data = parseJson(output);
  const closed = Array.isArray(data?.closed) ? data.closed : [];
  const still = Array.isArray(data?.still) ? data.still : [];
  if (still.length > 0) return { ok: false, reply: `${label} is still open. It may be asking you to save your work, so check the screen.` };
  if (closed.length === 0) return { ok: false, reply: `${label} does not appear to be running.` };
  return { ok: true, reply: `Closed ${label}.` };
}

const UNINSTALL_KEYS = `@(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)`;

async function findApp(query: string): Promise<SystemResponse> {
  const clean = query.trim().slice(0, 80);
  if (!clean) return { ok: false, reply: 'Which program should I look for?' };
  const output = await runPowerShell(`${payload({ clean })}
$keys = ${UNINSTALL_KEYS}
$names = @(Get-ItemProperty $keys -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -and $_.UninstallString -and ($_.DisplayName -like ('*' + $payload.clean + '*')) } |
  Select-Object -ExpandProperty DisplayName -Unique |
  Select-Object -First 12)
[pscustomobject]@{ ok = $true; names = $names } | ConvertTo-Json -Compress
`);
  const data = parseJson(output);
  const names = Array.isArray(data?.names) ? (data.names as string[]) : [];
  if (names.length === 0) return { ok: false, reply: `I could not find an installed program matching ${clean}.` };
  return { ok: true, reply: '', names };
}

async function uninstallApp(name: string): Promise<SystemResponse> {
  const clean = name.trim().slice(0, 200);
  if (!clean) return { ok: false, reply: 'Which program should I uninstall?' };
  await runPowerShell(`${payload({ clean })}
$keys = ${UNINSTALL_KEYS}
$item = Get-ItemProperty $keys -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -eq $payload.clean } |
  Select-Object -First 1
if (-not $item) { throw 'That program is no longer installed.' }
$command = $item.QuietUninstallString
if (-not $command) { $command = $item.UninstallString }
if (-not $command) { throw 'That program has no uninstall command.' }
Start-Process -FilePath cmd.exe -ArgumentList '/c', $command
[pscustomobject]@{ ok = $true } | ConvertTo-Json -Compress
`);
  return { ok: true, reply: `Opening the uninstaller for ${clean}. Follow the prompts on screen.` };
}

async function power(mode: 'shutdown' | 'restart' | 'sleep' | 'cancel'): Promise<SystemResponse> {
  if (mode === 'shutdown') {
    await runPowerShell('& shutdown.exe /s /t 30 | Out-Null;');
    return { ok: true, reply: 'Shutting down in 30 seconds. Say cancel shutdown to stop it.' };
  }
  if (mode === 'restart') {
    await runPowerShell('& shutdown.exe /r /t 30 | Out-Null;');
    return { ok: true, reply: 'Restarting in 30 seconds. Say cancel restart to stop it.' };
  }
  if (mode === 'sleep') {
    const sleepScript = "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)";
    const encoded = Buffer.from(sleepScript, 'utf16le').toString('base64');
    await runPowerShell(`Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-WindowStyle','Hidden','-EncodedCommand','${encoded}' -WindowStyle Hidden;`);
    return { ok: true, reply: 'Going to sleep now.' };
  }
  try {
    await runPowerShell('& shutdown.exe /a | Out-Null;');
    return { ok: true, reply: 'Shutdown cancelled.' };
  } catch {
    return { ok: true, reply: 'There is no pending shutdown or restart to cancel.' };
  }
}

async function runCommand(command: string): Promise<SystemResponse> {
  const clean = command.trim();
  if (!clean) return { ok: false, reply: 'What command should I run?' };
  if (isBlockedCommand(clean)) return { ok: false, reply: 'I will not run that command. It can damage Windows, so give me a more specific and safer one.' };
  const output = await runPowerShell(`${payload({ clean })}
$text = & $env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $payload.clean 2>&1 | Out-String
if ($text.Length -gt 4000) { $text = $text.Substring(0, 4000) + '... [truncated]' }
[pscustomobject]@{ ok = $true; output = $text.Trim() } | ConvertTo-Json -Compress
`);
  const data = parseJson(output);
  const text = typeof data?.output === 'string' ? data.output : '';
  return { ok: true, reply: text ? 'Command finished.' : 'Command finished with no output.', output: text };
}

async function sendEmail(to: string, subject: string, body: string): Promise<SystemResponse> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, reply: 'That email address does not look valid.' };
  const host = process.env.EMAIL_SMTP_HOST?.trim();
  const port = Number(process.env.EMAIL_SMTP_PORT || '465');
  const user = process.env.EMAIL_SMTP_USER?.trim();
  const pass = process.env.EMAIL_SMTP_PASS;
  const from = process.env.EMAIL_FROM?.trim() || user;
  if (!host || !user || !pass || !from) {
    return {
      ok: false,
      reply: 'Direct email is not configured. Add EMAIL_SMTP_HOST, EMAIL_SMTP_USER, EMAIL_SMTP_PASS and EMAIL_FROM to .env.local, then restart the app.',
    };
  }
  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await transporter.sendMail({ from, to, subject: subject.slice(0, 200), text: body.slice(0, 5000) });
  return { ok: true, reply: `Email sent to ${to}.` };
}

async function listFolder(folder: string): Promise<SystemResponse> {
  const relative = FOLDER_PATHS[folder];
  const label = FOLDER_LABELS[folder] || folder;
  if (relative === undefined) return { ok: false, reply: 'That folder is not in my allowlist.' };
  const output = await runPowerShell(`${payload({ relative })}
$path = Join-Path $env:USERPROFILE $payload.relative
if (-not (Test-Path -LiteralPath $path)) { throw 'Folder not found' }
$items = Get-ChildItem -LiteralPath $path -ErrorAction SilentlyContinue | Select-Object -First 30
$names = @($items | ForEach-Object { $_.Name })
[pscustomobject]@{ ok = $true; names = $names; count = @($names).Count } | ConvertTo-Json -Compress
`);
  const data = parseJson(output);
  const names = Array.isArray(data?.names) ? (data.names as string[]) : [];
  if (names.length === 0) return { ok: true, reply: `${label} is empty.` };
  const shown = names.slice(0, 8).join(', ');
  const extra = names.length > 8 ? `, and ${names.length - 8} more` : '';
  return { ok: true, reply: `${label} contains ${shown}${extra}.` };
}

async function scanImages(folder: string, query: string): Promise<SystemResponse> {
  const relative = FOLDER_PATHS[folder];
  const label = FOLDER_LABELS[folder] || folder;
  if (relative === undefined) return { ok: false, reply: 'That folder is not in my allowlist.' };
  const clean = query.trim().slice(0, 60);
  const output = await runPowerShell(`${payload({ relative, clean })}
$path = Join-Path $env:USERPROFILE $payload.relative
if (-not (Test-Path -LiteralPath $path)) { throw 'Folder not found' }
Add-Type -AssemblyName System.Drawing
$extensions = @('.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.tif', '.tiff')
$files = @(Get-ChildItem -LiteralPath $path -Recurse -Depth 5 -File -ErrorAction SilentlyContinue |
  Where-Object { $extensions -contains $_.Extension.ToLower() } |
  Sort-Object LastWriteTime -Descending)
if ($payload.clean) {
  $files = @($files | Where-Object { $_.Name -like ('*' + $payload.clean + '*') })
}
$count = $files.Count
$items = @()
foreach ($file in ($files | Select-Object -First 40)) {
  $width = 0; $height = 0; $taken = ''
  try {
    $image = [System.Drawing.Image]::FromFile($file.FullName)
    $width = $image.Width
    $height = $image.Height
    if ($image.PropertyIdList -contains 36867) {
      $taken = [System.Text.Encoding]::ASCII.GetString($image.GetPropertyItem(36867).Value).Trim([char]0).Trim()
    }
    $image.Dispose()
  } catch { }
  $items += [pscustomobject]@{
    name = $file.Name
    modified = $file.LastWriteTime.ToString('yyyy-MM-dd')
    taken = $taken
    megapixels = if ($width -gt 0) { [math]::Round(($width * $height) / 1000000, 1) } else { 0 }
    sizeMb = [math]::Round($file.Length / 1MB, 2)
  }
}
[pscustomobject]@{ ok = $true; count = $count; items = $items } | ConvertTo-Json -Compress -Depth 4
`);
  const data = parseJson(output);
  const count = typeof data?.count === 'number' ? (data.count as number) : 0;
  const items = Array.isArray(data?.items) ? (data.items as Array<Record<string, unknown>>) : [];
  if (count === 0) return { ok: false, reply: `I found no images in ${label}${clean ? ` matching ${clean}` : ''}.` };

  const lines = items.map((item) => {
    const date = String(item.taken || item.modified || '').slice(0, 10);
    const size = item.sizeMb ? `${item.sizeMb} MB` : '';
    const pixels = item.megapixels ? `${item.megapixels} megapixels` : '';
    return [String(item.name), date, pixels, size].filter(Boolean).join(' | ');
  });
  const summary = items.length
    ? lines
        .map((line) => line.split(' | ').slice(1).join(', '))
        .filter(Boolean)
        .reduce((acc: Record<string, number>, entry) => {
          const year = entry.slice(0, 4);
          if (/^\d{4}$/.test(year)) acc[year] = (acc[year] || 0) + 1;
          return acc;
        }, {})
    : {};
  const years = Object.entries(summary)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, total]) => `${total} from ${year}`)
    .join(', ');
  const shown = lines.slice(0, 3).join('; ');
  const extra = count > lines.length ? `, plus ${count - lines.length} more` : '';
  return {
    ok: true,
    reply: `I found ${count} image${count === 1 ? '' : 's'} in ${label}${clean ? ` matching ${clean}` : ''}. Newest: ${shown}${extra}.${years ? ` By year: ${years}.` : ''}`,
    output: lines.slice(0, 25).map((line, index) => `${index + 1}. ${line}`).join('\n'),
  };
}

async function dispatch(body: SystemRequest): Promise<SystemResponse> {
  switch (body.action) {
    case 'open-app':
      return openApp(body.app);
    case 'open-folder':
      return openFolder(body.folder);
    case 'system-info':
      return systemInfo();
    case 'volume':
      return changeVolume(body.direction, body.steps ?? 1);
    case 'set-volume':
      return setVolume(body.level);
    case 'screenshot':
      return screenshot();
    case 'lock':
      return lockPc();
    case 'search-files':
      return searchFiles(body.query);
    case 'list-folder':
      return listFolder(body.folder);
    case 'find-file':
      return findFiles(body.query, body.folder).then((paths) => {
        if (paths.length === 0) return { ok: false, reply: `I could not find a file matching ${body.query}.` };
        return { ok: true, reply: `Found ${paths.length} match${paths.length === 1 ? '' : 'es'}.`, paths };
      });
    case 'delete-file':
      return deleteFile(body.path);
    case 'close-app':
      return closeApp(body.app);
    case 'find-app':
      return findApp(body.query);
    case 'uninstall-app':
      return uninstallApp(body.name);
    case 'power':
      return power(body.mode);
    case 'run-command':
      return runCommand(body.command);
    case 'send-email':
      return sendEmail(body.to, body.subject, body.body);
    case 'scan-images':
      return scanImages(body.folder, body.query);
    default:
      return { ok: false, reply: 'I do not recognise that system action.' };
  }
}

export async function POST(request: NextRequest) {
  if (!localRequest(request)) return jsonError('System control is only available from this PC on localhost.', 403);

  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  const recent = (requestLog.get(address) || []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) return jsonError('Too many system requests. Wait a moment and try again.', 429);
  requestLog.set(address, [...recent, now]);

  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return jsonError('Expected a JSON request.', 415);
  }

  let body: SystemRequest;
  try {
    body = (await request.json()) as SystemRequest;
  } catch {
    return jsonError('The request body must be valid JSON.', 400);
  }
  if (!body || typeof body.action !== 'string') return jsonError('The request is missing an action.', 400);

  try {
    const result = await dispatch(body);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : 'Unknown error';
    return jsonError(`That system action failed: ${message.slice(0, 200)}`, 500);
  }
}
