/**
 * CALYX desktop packaging.
 *
 * Strategy: the project stays where it is on disk (the user's choice), and the
 * packaged app is a small shell that runs the local server from the project
 * folder. That avoids copying node_modules and the whole app into an asar,
 * which is slow, huge, and easy to break with absolute build paths.
 *
 * The project location is written into `resources/calyx-root.txt` at build time
 * so the packaged app knows where to look.
 */

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = __dirname;

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.calyx.console',
  productName: 'CALYX',

  files: ['desktop/**/*', 'package.json', '!node_modules/**/*'],

  extraResources: [
    { from: 'build/icon.ico', to: 'icon.ico' },
    { from: 'desktop/calyx-root.txt', to: 'calyx-root.txt' },
  ],

  directories: {
    output: 'dist-desktop',
    buildResources: 'build',
  },

  win: {
    icon: 'build/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'CALYX',
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    include: 'desktop/installer.nsh',
  },

  // The project location is recorded by scripts/record-root.cjs, run before pack.
  beforePack: async () => {
    const root = path.join(projectRoot, 'desktop', 'calyx-root.txt');
    if (!fs.existsSync(root)) {
      throw new Error('desktop/calyx-root.txt is missing. Run "node scripts/record-root.cjs" first.');
    }
    if (!fs.existsSync(path.join(projectRoot, '.next'))) {
      throw new Error('No production build found. Run "pnpm build" before packaging.');
    }
  },
};
