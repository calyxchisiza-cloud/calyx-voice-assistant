/**
 * Shared contract for the local PC bridge.
 *
 * The browser only ever sends an *id*; the commands and paths live on the
 * server, so the client can never ask it to run arbitrary code.
 */

export type SystemRequest =
  | { action: 'open-app'; app: string }
  | { action: 'open-folder'; folder: string }
  | { action: 'system-info' }
  | { action: 'volume'; direction: 'up' | 'down' | 'mute' | 'unmute'; steps?: number }
  | { action: 'set-volume'; level: number }
  | { action: 'screenshot' }
  | { action: 'lock' }
  | { action: 'search-files'; query: string }
  | { action: 'list-folder'; folder: string }
  // Destructive / privileged actions. The UI must confirm these aloud first.
  | { action: 'find-file'; query: string; folder?: 'downloads' | 'documents' | 'desktop' }
  | { action: 'delete-file'; path: string }
  | { action: 'close-app'; app: string }
  | { action: 'find-app'; query: string }
  | { action: 'uninstall-app'; name: string }
  | { action: 'power'; mode: 'shutdown' | 'restart' | 'sleep' | 'cancel' }
  | { action: 'run-command'; command: string }
  | { action: 'send-email'; to: string; subject: string; body: string }
  | { action: 'scan-images'; folder: string; query: string };

export type SystemResponse = {
  ok: boolean;
  reply: string;
  paths?: string[];
  names?: string[];
  output?: string;
};

export const APP_ALIASES: Record<string, { id: string; label: string }> = {
  notepad: { id: 'notepad', label: 'Notepad' },
  calculator: { id: 'calculator', label: 'Calculator' },
  calc: { id: 'calculator', label: 'Calculator' },
  paint: { id: 'paint', label: 'Paint' },
  'file explorer': { id: 'explorer', label: 'File Explorer' },
  explorer: { id: 'explorer', label: 'File Explorer' },
  files: { id: 'explorer', label: 'File Explorer' },
  computer: { id: 'explorer', label: 'File Explorer' },
  'this pc': { id: 'explorer', label: 'File Explorer' },
  settings: { id: 'settings', label: 'Settings' },
  'task manager': { id: 'taskmanager', label: 'Task Manager' },
  camera: { id: 'camera', label: 'Camera' },
  'snipping tool': { id: 'snippingtool', label: 'Snipping Tool' },
  'control panel': { id: 'controlpanel', label: 'Control Panel' },
  'command prompt': { id: 'cmd', label: 'Command Prompt' },
  cmd: { id: 'cmd', label: 'Command Prompt' },
  terminal: { id: 'terminal', label: 'Terminal' },
  powershell: { id: 'powershell', label: 'PowerShell' },
  word: { id: 'word', label: 'Word' },
  excel: { id: 'excel', label: 'Excel' },
  powerpoint: { id: 'powerpoint', label: 'PowerPoint' },
  outlook: { id: 'outlook', label: 'Outlook' },
  spotify: { id: 'spotify', label: 'Spotify' },
  'visual studio code': { id: 'vscode', label: 'Visual Studio Code' },
  'vs code': { id: 'vscode', label: 'Visual Studio Code' },
  vscode: { id: 'vscode', label: 'Visual Studio Code' },
  chrome: { id: 'chrome', label: 'Chrome' },
  'google chrome': { id: 'chrome', label: 'Chrome' },
  edge: { id: 'edge', label: 'Edge' },
  'microsoft edge': { id: 'edge', label: 'Edge' },
  firefox: { id: 'firefox', label: 'Firefox' },
  steam: { id: 'steam', label: 'Steam' },
  discord: { id: 'discord', label: 'Discord' },
  whatsapp: { id: 'whatsapp', label: 'WhatsApp' },
  telegram: { id: 'telegram', label: 'Telegram' },
  clock: { id: 'clock', label: 'Clock' },
  mail: { id: 'mail', label: 'Mail' },
  store: { id: 'store', label: 'Microsoft Store' },
  'app store': { id: 'store', label: 'Microsoft Store' },
  'microsoft store': { id: 'store', label: 'Microsoft Store' },
  'ms store': { id: 'store', label: 'Microsoft Store' },
  'installed apps': { id: 'installed apps', label: 'Installed apps' },
  'add or remove programs': { id: 'installed apps', label: 'Installed apps' },
  'uninstall a program': { id: 'uninstall', label: 'the uninstall page' },
  updates: { id: 'updates', label: 'Windows Update' },
  'windows update': { id: 'updates', label: 'Windows Update' },
  storage: { id: 'storage', label: 'Storage settings' },
  display: { id: 'display', label: 'Display settings' },
  sound: { id: 'sound', label: 'Sound settings' },
  bluetooth: { id: 'bluetooth', label: 'Bluetooth settings' },
  'default apps': { id: 'default apps', label: 'Default apps' },
  startup: { id: 'startup', label: 'Startup apps' },
};

export const FOLDER_ALIASES: Record<string, { id: string; label: string }> = {
  downloads: { id: 'downloads', label: 'Downloads' },
  documents: { id: 'documents', label: 'Documents' },
  desktop: { id: 'desktop', label: 'Desktop' },
  pictures: { id: 'pictures', label: 'Pictures' },
  music: { id: 'music', label: 'Music' },
  videos: { id: 'videos', label: 'Videos' },
  home: { id: 'home', label: 'your home folder' },
  profile: { id: 'home', label: 'your home folder' },
  temp: { id: 'temp', label: 'the temp folder' },
};

/**
 * Commands CALYX refuses even after a spoken confirmation. This is a safety
 * net, not a sandbox: "run PowerShell" is deliberately arbitrary.
 */
export const BLOCKED_COMMAND_PATTERNS: RegExp[] = [
  /\bformat(?:-volume)?\b/i,
  /\bdiskpart\b/i,
  /\bclean\s+all\b/i,
  /\bcipher\s+\/w/i,
  /\bvssadmin\b[^\n]*\bdelete\b/i,
  /\bbcdedit\b/i,
  /\breg(?:\.exe)?\s+delete\b/i,
  /\bremove-item\b[^\n]*\b(?:c:\\windows|system32)\b/i,
  /\bremove-item\b[^\n]*\bc:\\\s*$/i,
  /\b(?:stop-computer|restart-computer|shutdown)\b/i,
];

export function isBlockedCommand(command: string) {
  return BLOCKED_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export function isAffirmative(text: string) {
  const clean = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^please\s+/, '')
    .replace(/\s+please$/, '');
  if (!clean) return false;
  return /^(?:yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|do it|go ahead|please do|absolutely|affirmative)$/.test(clean);
}

export function isNegative(text: string) {
  const clean = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(?:thanks|thank you)$/, '');
  if (!clean) return false;
  return /^(?:no|nope|nah|cancel|abort|stop|dont|do not|negative|forget it|never mind|nevermind)$/.test(clean);
}
