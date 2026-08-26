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
if (!fs.existsSync(path.join(unpacked, 'app.exe'))) {
  console.error('app.exe is missing from win-unpacked — the electron-builder step failed.');
  process.exit(1);
}

// Remove dev-machine cruft so it never ships inside the portable zip.
fs.rmSync(path.join(unpacked, 'python', '__pycache__'), { recursive: true, force: true });

let res;
if (process.platform === 'win32') {
  res = spawnSync('powershell', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${unpacked}\\*' -DestinationPath '${outZip}' -Force`],
    { stdio: 'inherit' });
} else {
  res = spawnSync('zip', ['-qr', outZip, '.'], { cwd: unpacked, stdio: 'inherit' });
}

// Fail LOUDLY if the packer itself couldn't run (e.g. `zip` not installed).
// Previously `res.status ?? 0` treated a missing binary as success.
if (res.error) {
  console.error(`\nPackaging tool failed to launch: ${res.error.message}`);
  if (process.platform !== 'win32') {
    console.error("Install the zip CLI and retry:  sudo apt-get install -y zip");
  }
  process.exit(1);
}
if (res.status !== 0) process.exit(res.status ?? 1);

// Verify the archive really exists before claiming victory.
if (!fs.existsSync(outZip)) {
  console.error('\nZip step finished but ViralClipper-portable.zip was not created.');
  process.exit(1);
}
const mb = (fs.statSync(outZip).size / 1024 / 1024).toFixed(1);
console.log(`\nCreated release/ViralClipper-portable.zip (${mb} MB)`);
process.exit(0);
