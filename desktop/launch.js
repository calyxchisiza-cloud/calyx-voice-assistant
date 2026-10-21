/**
 * CALYX launcher.
 *
 * Started hidden by CALYX.vbs. Runs the desktop shell as a plain Node process so
 * the server and the window are managed by one parent that can shut both down
 * cleanly. Using Electron's binary with ELECTRON_RUN_AS_NODE avoids depending on
 * a system-wide Node installation.
 */

const path = require('node:path');

process.env.ELECTRON_RUN_AS_NODE = '1';

// Set the app name early so any Electron-provided paths derive from it.
process.title = 'CALYX';

require(path.join(__dirname, 'main.js'));
