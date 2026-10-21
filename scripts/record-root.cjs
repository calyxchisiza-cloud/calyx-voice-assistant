/**
 * Records the absolute project path so the packaged CALYX app can find its
 * server files. Regenerated on every build, so moving the folder only requires
 * re-running the build.
 */

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const marker = path.join(projectRoot, 'desktop', 'calyx-root.txt');

fs.mkdirSync(path.dirname(marker), { recursive: true });
fs.writeFileSync(marker, projectRoot, 'utf8');
console.log(`CALYX project root recorded: ${projectRoot}`);
