/**
 * Builds the CALYX app icon: PNGs in several sizes plus a real .ico container.
 *
 * Run with: node scripts/make-icon.mjs
 *
 * Uses sharp (already present as a Next.js dependency) to rasterize the SVG, then
 * assembles the .ico bytes directly so no extra tool is needed.
 */

import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(projectRoot, 'build');
const svgPath = path.join(buildDir, 'icon.svg');

// Resolve sharp from wherever the package manager hoisted it.
function loadSharp() {
  try {
    return require('sharp');
  } catch {
    const pnpmDir = path.join(projectRoot, 'node_modules', '.pnpm');
    const fs = require('node:fs');
    const match = fs.readdirSync(pnpmDir).find((entry) => entry.startsWith('sharp@'));
    if (!match) throw new Error('sharp is not installed; run "pnpm install" first.');
    return require(path.join(pnpmDir, match, 'node_modules', 'sharp'));
  }
}

const sharp = loadSharp();

const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Assemble an .ico from PNG buffers (ICO supports embedded PNG since Vista). */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = 6 + directory.length;

  entries.forEach((entry, index) => {
    const base = index * 16;
    // 256 is encoded as 0 in the ICO directory.
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 0);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 1);
    directory.writeUInt8(0, base + 2); // palette
    directory.writeUInt8(0, base + 3); // reserved
    directory.writeUInt16LE(1, base + 4); // colour planes
    directory.writeUInt16LE(32, base + 6); // bits per pixel
    directory.writeUInt32LE(entry.data.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)]);
}

async function main() {
  await mkdir(buildDir, { recursive: true });
  const svg = await readFile(svgPath);

  const entries = [];
  for (const size of PNG_SIZES) {
    const data = await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    entries.push({ size, data });

    const pngName = size === 256 ? 'icon.png' : `icon-${size}.png`;
    await writeFile(path.join(buildDir, pngName), data);
  }

  const ico = buildIco(entries.filter((entry) => entry.size >= 16));
  await writeFile(path.join(buildDir, 'icon.ico'), ico);

  // The Next.js app route uses an SVG; keep a copy of the branded mark in sync.
  await writeFile(path.join(projectRoot, 'app', 'icon.svg'), svg);

  const summary = entries.map((entry) => `${entry.size}px`).join(', ');
  console.log(`CALYX icon written: icon.ico + PNGs (${summary})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
