# CALYX

A local, voice-first assistant for Windows. Runs entirely on your PC.

---

## Starting CALYX (no terminal)

Once set up, you **double-click the CALYX icon** on your Desktop. That's it.

A CALYX window opens. The local server starts hidden in the background and stops
when you close the window. No terminal, no black console.

### First-time setup (do this once)

Open a terminal in this folder and run:

```powershell
pnpm install
pnpm build
powershell -ExecutionPolicy Bypass -File scripts\install-shortcuts.ps1
```

The last command creates the **CALYX** shortcut on your Desktop and in your
Start Menu.

To also have CALYX start automatically when you log in:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-shortcuts.ps1 -StartWithWindows
```

### Building a real installer

```powershell
pnpm desktop:installer
```

This produces an installer in `dist-desktop\`. It installs CALYX like a normal
program, with Desktop and Start Menu shortcuts and an entry in "Add or remove
programs".

---

## How it works

The window is a local web app (Next.js) hosted in Edge's app window. The server
must run locally because the PC-control features — closing apps, deleting files,
reading system info — execute on **your** machine. A plain browser page cannot do
those things safely, which is why CALYX ships as its own app.

```
Double-click CALYX
   └─ Launcher starts (no window, no terminal)
        └─ Local server starts, hidden          http://127.0.0.1:3210
             └─ Edge opens the console in a chromeless app window
                  └─ Close the window → server stops
```

Port **3210** is used deliberately so it never collides with a development
server on 3000.

### Why Edge and not Electron

The free voice engine uses the browser's Web Speech API. That API sends audio to
Microsoft's or Google's speech service, and **Chromium — which Electron is built
on — has no access to either.** In an Electron window recognition starts,
captures audio, then dies with a `network` error, so voice silently never works.

Edge ships Microsoft's speech service and works correctly, so the launcher
prefers Edge. It opens in Edge's `--app` mode, which is a normal-looking window
with its own taskbar entry and no address bar or tabs.

If Edge is missing, the launcher falls back to Electron. Everything works except
voice input, and the app now says so instead of failing silently. On first run
the launcher also pre-grants microphone permission for CALYX's address, so voice
works immediately rather than waiting on a permission prompt.


---

## Voice engine

CALYX runs **free by default**: your browser's speech recognition and voice,
with a free Gemini key for the "brain". No OpenAI credits required.

You can switch to OpenAI Realtime in **Settings → Engine** if you have credits.
That engine is lower-latency and more natural, but it is optional.

---

## What CALYX can do

**Everyday**
- Time, date, timers, calculations, unit conversions, notes, and lists
- Weather and web searches

**Your PC**
- Report CPU, memory, disk, battery, uptime, Windows version, computer name
- Set, mute, and unmute the volume
- Take a screenshot (saved to `Pictures\CALYX\Screenshots`)
- Lock the PC

**Files and apps**
- List and search Desktop, Documents, and Downloads
- Scan Pictures / Downloads / Documents / Desktop for images, reporting counts,
  dates, resolution, and size
- Open allowlisted apps and folders, the Microsoft Store, and Windows settings
  pages
- Close apps, delete files (to the Recycle Bin), uninstall programs
- Open the uninstaller for an app so you can finish removing it

**Email**
- Compose an email in your default mail app
- Send email directly (needs SMTP settings — see below)

**Power**
- Shut down, restart, or sleep

**PowerShell**
- Run a command you dictate

### Everything destructive asks first

CALYX asks aloud and waits for a spoken **yes** or **no** (about 15–30 seconds;
anything else cancels). Closing apps, deleting, uninstalling, shutting down,
sending email, and running commands all require confirmation.

Deletes go to the **Recycle Bin** — never permanently. Files can only be deleted
from Desktop, Documents, and Downloads. Catastrophic commands (`format`,
`diskpart`, and similar) are refused even if you confirm.

---

## Optional: send email directly

Add these to `.env.local`, then restart CALYX:

```
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=465
EMAIL_SMTP_USER=you@gmail.com
EMAIL_SMTP_PASS=your-app-password
EMAIL_FROM=you@gmail.com
```

For Gmail: turn on 2-Step Verification, then create an **App Password** and use
that (not your normal password). Without these, CALYX honestly reports that
direct email is not configured and offers to open your mail app instead.

---

## Development

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Development server on `http://localhost:3000` |
| `pnpm build` | Production build |
| `pnpm start` | Run the production build |
| `pnpm typecheck` | Type check |
| `pnpm lint` | Lint |
| `pnpm icon` | Regenerate the app icon |
| `pnpm desktop` | Run the desktop app from source |
| `pnpm desktop:installer` | Build a Windows installer |
| `scripts\verify-shortcut.ps1` | Check the shortcut opens a visible window |
| `scripts\install-shortcuts.ps1` | (Re)create the Desktop and Start Menu icons |
| `scripts\fetch-electron.ps1` | Recover the bundled Electron runtime |

### Environment

`.env.local` holds your keys and is git-ignored:

```
OPENAI_API_KEY=...      # only needed for the Realtime engine
GEMINI_API_KEY=...      # used by the free engine
```

---

## If the shortcut does not open a window

The shortcut runs `CALYX.vbs`, which starts the launcher with no console. If
nothing appears, check these in order:

1. **Confirm a window exists.** Run this in the project folder:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\verify-shortcut.ps1
   ```

   This launches CALYX from the real Start Menu shortcut, twice, and reports
   whether a *visible* window appeared. Two passes means the shortcut is healthy.

2. **No production build.** A build is required for the desktop app. Run
   `pnpm build`. The launcher will show a message box if `.next` is missing.

3. **Bundled runtime missing.** Package managers sometimes skip Electron's
   install script. Run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\fetch-electron.ps1
   ```

4. **The folder moved.** The desktop build records the project path. Re-run
   `pnpm build` and the shortcut installer (see *Moving CALYX* below).

5. **An orphaned server on port 3210.** Closing the window normally stops the
   server. If a crash left one behind, CALYX reuses it on the next launch. To
   force a clean state:

   ```powershell
   Get-NetTCPConnection -LocalPort 3210 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
   ```

The window is shown by whichever happens first: the page finishing its first
paint, the page finishing loading, or a four-second fallback. It is never left
invisible waiting on a single event.

---

## If voice does not respond

Voice needs two things: microphone permission, and a reachable speech service.

1. **Check the app tells you.** If recognition cannot start, CALYX now shows a
   message instead of sitting silent. Read it — it names the cause.

2. **Microphone permission.** The launcher pre-grants this for CALYX's address on
   first run. If you previously clicked "Block" in an Edge prompt, clear it:
   open the CALYX window, click the lock/settings icon next to the address, and
   allow the microphone.

3. **Windows microphone access.** Settings → Privacy & security → Microphone —
   make sure "Let desktop apps access your microphone" is on.

4. **A different shell.** If you are running CALYX in Chrome (`pnpm dev` →
   `http://localhost:3000`) voice works there too. If you are in the Electron
   fallback window, voice cannot work; the app will tell you.

5. **The brain, not the ears.** If CALYX hears you (your words appear in the
   transcript) but never answers, the problem is the reply engine. Check that
   `GEMINI_API_KEY` in `.env.local` is valid, then restart.

---

## Moving CALYX

If you move this folder, re-run:

```powershell
pnpm build
powershell -ExecutionPolicy Bypass -File scripts\install-shortcuts.ps1
```

The desktop build records the project location, so an installed CALYX needs to
know where the folder went.
