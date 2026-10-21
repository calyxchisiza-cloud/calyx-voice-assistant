/**
 * CALYX desktop shell.
 *
 * Runs the console in its own window with no browser chrome and no terminal,
 * starting the local server first and stopping it when the window closes.
 *
 * Why Edge and not Electron:
 *   The free voice engine uses the Web Speech API. Chromium — and therefore
 *   Electron — has no access to Google's speech service, so recognition starts,
 *   captures audio, then dies with a "network" error. Edge ships Microsoft's
 *   online speech service and works correctly, so Edge is the preferred shell.
 *   Electron remains the fallback when Edge is unavailable; voice then needs
 *   another engine, and the UI says so instead of failing silently.
 *
 * The server must run locally because the PC-control features execute on this
 * machine. A plain browser tab cannot do those things.
 */

const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const HOST = '127.0.0.1';
const PORT = 3210;
const BASE_URL = `http://${HOST}:${PORT}`;
const projectRoot = path.join(__dirname, '..');

/** @type {import('node:child_process').ChildProcess | null} */
let serverProcess = null;
/** @type {import('node:child_process').ChildProcess | null} */
let shellProcess = null;
let shuttingDown = false;
let adoptedServer = false;
/** Recorded when the spawned server exits, so boot can explain the failure. */
let lastServerExit = null;

/* ------------------------------------------------------------------ helpers */

function log(message) {
  process.stdout.write(`[calyx] ${message}\n`);
}

function readProjectRoot() {
  // A packaged build records the project location at build time.
  try {
    const marker = path.join(process.resourcesPath, 'calyx-root.txt');
    if (fs.existsSync(marker)) {
      const recorded = fs.readFileSync(marker, 'utf8').trim();
      if (recorded && fs.existsSync(path.join(recorded, 'package.json'))) return recorded;
    }
  } catch {
    // Fall through to the development layout.
  }
  return projectRoot;
}

/** Locates msedge.exe in the usual install locations. */
function findEdge() {
  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** True when something is already serving CALYX on our port. */
function serverAlreadyRunning() {
  return new Promise((resolve) => {
    const request = http.get({ host: HOST, port: PORT, path: '/', timeout: 1500 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 4000) response.destroy();
      });
      const done = () => resolve(/CALYX|calyx/i.test(body) || response.statusCode === 200);
      response.on('end', done);
      response.on('close', done);
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

/** Poll the server until it responds, or give up after `timeoutMs`. */
function waitForServer(timeoutMs = 90_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (shuttingDown) return reject(new Error('shutting down'));
      const request = http.get({ host: HOST, port: PORT, path: '/', timeout: 2000 }, (response) => {
        response.resume();
        resolve(true);
      });
      const fail = () => {
        if (Date.now() - started > timeoutMs) reject(new Error('The CALYX server did not start in time.'));
        else setTimeout(attempt, 400);
      };
      request.on('error', fail);
      request.on('timeout', () => {
        request.destroy();
        fail();
      });
    };
    attempt();
  });
}

function startServer() {
  const root = readProjectRoot();
  const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!fs.existsSync(nextBin)) {
    throw new Error(`Could not find the Next.js runtime at ${nextBin}. Run "pnpm install" once in the project folder.`);
  }

  // The launcher runs with no visible console, so anything the server prints
  // would otherwise vanish. Keep a log on disk so a failed start is diagnosable
  // instead of silent.
  const logPath = serverLogPath();
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, `[calyx] server start ${new Date().toISOString()}\n  exec: ${process.execPath}\n  next: ${nextBin}\n  cwd:  ${root}\n`);
  } catch {
    // Logging is best effort.
  }
  let logStream = null;
  try {
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
  } catch {
    logStream = null;
  }
  const writeLog = (chunk) => {
    const text = String(chunk);
    log(text.trimEnd());
    try {
      logStream?.write(text);
    } catch {
      // Ignore log write failures.
    }
  };

  serverProcess = spawn(process.execPath, [nextBin, 'start', '-H', HOST, '-p', String(PORT)], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Electron sets these for its own process; Next must not inherit them or it
      // tries to run as an Electron renderer.
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(PORT),
    },
  });

  serverProcess.stdout?.on('data', writeLog);
  serverProcess.stderr?.on('data', writeLog);
  serverProcess.on('error', (error) => writeLog(`spawn failed: ${error.message}\n`));
  serverProcess.on('exit', (code, signal) => {
    // Record the exit so a start that dies immediately is obvious in the log.
    writeLog(`server exited with code ${code}${signal ? ` signal ${signal}` : ''}\n`);
    lastServerExit = { code, signal, at: Date.now() };
  });
}

/** Where the hidden server's output is written, for troubleshooting. */
function serverLogPath() {
  return path.join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'CALYX', 'server.log');
}

/** Returns the tail of the server log, for error dialogs. */
function readServerLogTail(maxChars = 1200) {
  try {
    const text = fs.readFileSync(serverLogPath(), 'utf8');
    return text.slice(-maxChars).trim();
  } catch {
    return '';
  }
}

function killTree(pid) {
  try {
    if (process.platform === 'win32') {
      // A plain kill() on Windows leaves the grandchild node process alive.
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    // Shutdown must never throw.
  }
}

function stopServer() {
  // Never stop a server this process did not start.
  if (adoptedServer) {
    serverProcess = null;
    return;
  }
  if (serverProcess && !serverProcess.killed) killTree(serverProcess.pid);
  serverProcess = null;
}

/* -------------------------------------------------------------------- shell */

/**
 * Records microphone and speech-service consent for the CALYX origin in Edge's
 * profile, so the first launch never stalls on a permission bubble the user
 * might not notice. Edge stores per-origin decisions in the profile's
 * Preferences file; the app's own origin is the only one granted.
 */
function grantEdgePermissions(profileDir) {
  const prefsPath = path.join(profileDir, 'Default', 'Preferences');
  try {
    fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
    let prefs = {};
    if (fs.existsSync(prefsPath)) {
      try {
        prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
      } catch {
        prefs = {};
      }
    }
    if (typeof prefs !== 'object' || prefs === null) prefs = {};

    const profile = (prefs.profile = prefs.profile || {});
    const contentSettings = (profile.content_settings = profile.content_settings || {});
    const exceptions = (contentSettings.exceptions = contentSettings.exceptions || {});
    const origin = `${BASE_URL},*`;

    exceptions.media_stream_mic = exceptions.media_stream_mic || {};
    exceptions.media_stream_mic[origin] = { setting: 1 };
    exceptions.media_stream_camera = exceptions.media_stream_camera || {};
    exceptions.media_stream_camera[origin] = { setting: 1 };
    // Speech recognition is an "unrestricted" feature that must be explicitly
    // allowed; the Web Speech API uses it for the microphone.
    exceptions['unrestricted-sound'] = exceptions['unrestricted-sound'] || {};
    exceptions['unrestricted-sound'][origin] = { setting: 1 };

    fs.writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch (error) {
    // The launcher must not fail because of a permission file. Edge will simply
    // ask the user the first time instead.
    log(`could not pre-grant microphone permission: ${error.message}`);
  }
}

/**
 * Opens CALYX in Edge's app window. `--app` gives a chromeless window with its
 * own taskbar entry, which is what makes it feel like a desktop program.
 * A dedicated profile keeps its permissions and session state separate from the
 * user's normal browsing.
 */
function launchEdge(edgePath) {
  const profileDir = path.join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'CALYX', 'edge-profile');
  try {
    fs.mkdirSync(profileDir, { recursive: true });
  } catch {
    // A missing profile directory is not fatal; Edge will create one.
  }

  // Pre-grant microphone + speech access for the CALYX origin.
  //
  // Without this, the first launch shows a permission bubble. If the user misses
  // it, recognition never starts and the app looks broken — which is the exact
  // failure the user reported. Writing the grant means voice just works.
  grantEdgePermissions(profileDir);

  const args = [
    `--app=${BASE_URL}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=msEdgeFirstRunExperience',
    // Needed for microphone capture from a local origin.
    '--unsafely-treat-insecure-origin-as-secure=' + BASE_URL,
  ];

  shellProcess = spawn(edgePath, args, { windowsHide: false, stdio: 'ignore', detached: false });
  shellProcess.on('error', (error) => log(`edge error: ${error.message}`));

  // Edge's app window closing takes the browser process with it, which ends the
  // server too. There is no reliable "window closed" event, so poll the child.
  shellProcess.on('exit', () => {
    if (!shuttingDown) {
      shuttingDown = true;
      stopServer();
      process.exit(0);
    }
  });

  log(`window opened in Edge (${path.basename(edgePath)})`);
}

/** Fallback shell: Electron. Voice recognition will not work in this window. */
function launchElectron() {
  let electron;
  try {
    electron = require('electron');
  } catch {
    throw new Error('Neither Edge nor Electron is available to display the window.');
  }
  const { app, BrowserWindow, shell, dialog } = electron;

  const revealWindow = (win) => () => {
    if (!win || win.isDestroyed() || win.isVisible()) return;
    win.show();
    win.focus();
  };

  app.whenReady().then(() => {
    const win = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 900,
      minHeight: 640,
      show: false,
      backgroundColor: '#04050a',
      title: 'CALYX',
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });

    // Reveal on whichever happens first. Waiting only on 'ready-to-show' left the
    // app running with no visible window when the renderer never painted.
    const reveal = revealWindow(win);
    win.once('ready-to-show', reveal);
    win.webContents.once('did-finish-load', reveal);
    win.webContents.once('did-fail-load', (_e, code, description) => {
      reveal();
      dialog.showErrorBox('CALYX could not load', `The console page failed to load (${code} ${description}).`);
    });
    const timer = setTimeout(reveal, 4000);
    win.once('show', () => clearTimeout(timer));
    win.on('closed', () => clearTimeout(timer));

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.on('closed', () => {
      shuttingDown = true;
      stopServer();
      app.quit();
    });

    win.loadURL(BASE_URL);
  });

  app.on('window-all-closed', () => {
    shuttingDown = true;
    stopServer();
    app.quit();
  });
  app.on('before-quit', () => {
    shuttingDown = true;
    stopServer();
  });
  process.on('exit', stopServer);

  log('window opened in Electron — voice input is unavailable in this shell');
}

/* --------------------------------------------------------------------- boot */

async function boot() {
  const edgePath = findEdge();
  if (!edgePath) log('Edge was not found; falling back to Electron (no voice input there).');

  adoptedServer = await serverAlreadyRunning();
  if (!adoptedServer) startServer();
  await waitForServer();

  if (edgePath) launchEdge(edgePath);
  else launchElectron();
}

/** Shows a native message box. Used when the app cannot start at all. */
function reportFatal(message, detail) {
  const body = detail ? `${message}\n\n--- server log ---\n${detail}` : message;
  try {
    // mshta's popup works without any Electron/Chromium dependency, so it is
    // still available when the shell itself is the thing that failed.
    const escaped = body.replace(/'/g, "''");
    spawnSync(
      'mshta',
      [`vbscript:Execute("MsgBox ""${escaped.replace(/"/g, '""')}"", 16, ""CALYX"":close")`],
      { windowsHide: true, stdio: 'ignore' },
    );
  } catch {
    // Nothing more can be done.
  }
}

process.on('SIGINT', () => {
  shuttingDown = true;
  stopServer();
  process.exit(0);
});

boot().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  log(`fatal: ${message}`);
  stopServer();

  // A silent failure here is the worst outcome: the user double-clicks the icon
  // and nothing happens. Explain it, and point at the log.
  const hint = adoptedServer
    ? 'CALYX could not reach its own server.'
    : lastServerExit
      ? `The CALYX server stopped as soon as it started (exit code ${lastServerExit.code}).`
      : 'The CALYX server did not start.';
  reportFatal(
    `${hint}\n\n${message}\n\nA log was written to:\n${serverLogPath()}\n\nThe usual cause is a missing production build. In the project folder run:\n    pnpm build`,
    readServerLogTail(),
  );
  process.exit(1);
});
