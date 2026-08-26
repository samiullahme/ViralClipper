// scripts/zip-portable.mjs — zips release/win-unpacked into
// release/ViralClipper-portable.zip (the final "extract & run" folder).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const unpacked = path.join(root, 'release', 'win-unpacked');
const outZip = path.join(root, 'release', 'ViralClipper-portable.zip');

if (!fs.existsSync(unpacked)) {
  console.error('release/win-unpacked not found. Run "npm run dist" first.');
  process.exit(1);
}

// Sanity report: what made it into the portable folder.
for (const name of ['app.exe', 'ffmpeg.exe', 'python/transcribe.py',
  'resources/frame_overlay.png', 'resources/app.ico']) {
  const p = path.join(unpacked, name.replace('/', path.sep));
  console.log(`${fs.existsSync(p) ? '[ok]' : '[--]'} ${name}`);
}

let res;
if (process.platform === 'win32') {
  res = spawnSync('powershell', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${unpacked}\\*' -DestinationPath '${outZip}' -Force`],
    { stdio: 'inherit' });
} else {
  res = spawnSync('zip', ['-qr', outZip, '.'], { cwd: unpacked, stdio: 'inherit' });
}
process.exit(res.status ?? 0);
