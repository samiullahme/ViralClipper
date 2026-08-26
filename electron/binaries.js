// electron/binaries.js — locates / auto-downloads external binaries.
//  - ffmpeg.exe  (static build, extracted next to app.exe)
//  - Embedded Python 3.10 + faster-whisper (tiny/base models run on CPU)
// Everything is streamed with progress callbacks; nothing is buffered in RAM.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const FFMPEG_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const PYTHON_URL = 'https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip';
const GETPIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

/** Candidate locations for ffmpeg (portable root first, then resources/, then PATH). */
function locateFfmpeg(root) {
  const cands = [
    process.env.VC_FFMPEG,
    path.join(root, 'ffmpeg.exe'),
    path.join(root, 'ffmpeg'), // dev on linux/mac
    path.join(root, 'resources', 'ffmpeg.exe'),
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  // Fall back to an ffmpeg available on PATH.
  const probe = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
  try {
    const out = spawnSync(probe, { shell: true, encoding: 'utf8' });
    const p = (out.stdout || '').split(/\r?\n/)[0]?.trim();
    if (p && fs.existsSync(p)) return p;
  } catch { /* ignore */ }
  return null;
}

/** Locate embedded python (python/python.exe in the portable folder). */
function locatePython(root) {
  const exe = process.platform === 'win32' ? 'python.exe' : 'python3.10';
  const cands = [
    path.join(root, 'python', exe),
    path.join(root, 'resources', 'python', exe),
  ];
  return cands.find((c) => fs.existsSync(c)) || null;
}

function status(root) {
  return { ffmpeg: !!locateFfmpeg(root), python: !!locatePython(root) };
}

/**
 * Download url -> dest file, following redirects.
 * onProg(receivedBytes,totalBytes). Resolves when complete.
 */
function download(url, dest, onProg, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'ViralClipper/1.0' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        const loc = new URL(res.headers.location, url).toString();
        return resolve(download(loc, dest, onProg, redirects + 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`));
      }
      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        received += chunk.length;
        onProg && onProg(received, total);
      });
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

/** Extract a zip archive (PowerShell on Windows, unzip elsewhere). */
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const cmd = process.platform === 'win32'
      ? ['powershell', ['-NoProfile', '-Command',
          `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`]]
      : ['unzip', ['-o', '-q', zipPath, '-d', destDir]];
    const [exe, args] = cmd;
    const child = spawn(exe, args, { stdio: 'ignore' });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Unzip failed (${exe}) code ${code}`)));
    child.on('error', reject);
  });
}

/** Patch the embeddable python ._pth file so pip-installed packages are importable. */
function patchEmbedPth(pyDir) {
  const pth = fs.readdirSync(pyDir).find((f) => /^python\d+\._pth$/i.test(f));
  if (!pth) return;
  const f = path.join(pyDir, pth);
  let lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines = lines.map((l) => (l.trim() === '#import site' ? 'import site' : l));
  for (const need of ['Lib/site-packages', '.']) {
    if (!lines.some((l) => l.trim() === need)) lines.push(need);
  }
  fs.writeFileSync(f, lines.join('\n'));
}

/** Run a command, streaming combined output to onLine(line). */
function run(cmd, args, opts, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts });
    let buf = '';
    const feed = (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n|\r/);
      buf = lines.pop();
      lines.forEach((l) => onLine && onLine(l));
    };
    child.stdout?.on('data', feed);
    child.stderr?.on('data', feed);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    child.on('error', reject);
  });
}

let running = false;

/**
 * Ensure both binaries exist; download+install whatever is missing.
 * Emits progress objects: {step,label,received,total,percent,done,error}
 */
async function ensure(onProgress, rootOverride) {
  const root = rootOverride;
  if (!root) throw new Error('ensure(): root directory is required');
  if (running) return status(root);
  running = true;
  const emit = (s) => onProgress && onProgress(s);
  try {
    // ---- ffmpeg ------------------------------------------------------------
    if (!locateFfmpeg(root)) {
      emit({ step: 'ffmpeg', label: 'Downloading FFmpeg…', percent: 0 });
      const zip = path.join(require('os').tmpdir(), 'vc_ffmpeg.zip');
      await download(FFMPEG_URL, zip, (r, t) =>
        emit({ step: 'ffmpeg', label: 'Downloading FFmpeg…', received: r, total: t,
               percent: t ? Math.round((r / t) * 100) : 0 }));
      emit({ step: 'ffmpeg', label: 'Extracting FFmpeg…' });
      const tmpEx = path.join(require('os').tmpdir(), 'vc_ffmpeg_extract');
      await extractZip(zip, tmpEx);
      // Find ffmpeg.exe inside the extracted tree and move it to the root.
      const found = findFileRecursive(tmpEx, /^ffmpeg(\.exe)?$/i);
      if (!found) throw new Error('ffmpeg not found inside downloaded archive');
      const dest = path.join(root, path.basename(found));
      fs.renameSync(found, dest);
      fs.rmSync(zip, { force: true });
      fs.rmSync(tmpEx, { recursive: true, force: true });
    }

    // ---- python + faster-whisper ---------------------------------------------
    if (!locatePython(root)) {
      const pyDir = path.join(root, 'python');
      const pyExe = path.join(pyDir, process.platform === 'win32' ? 'python.exe' : 'python3.10');
      fs.mkdirSync(pyDir, { recursive: true });

      emit({ step: 'python', label: 'Downloading Python…', percent: 0 });
      const pyZip = path.join(require('os').tmpdir(), 'vc_python.zip');
      await download(PYTHON_URL, pyZip, (r, t) =>
        emit({ step: 'python', label: 'Downloading Python…', received: r, total: t,
               percent: t ? Math.round((r / t) * 100) : 0 }));
      emit({ step: 'python', label: 'Extracting Python…' });
      await extractZip(pyZip, pyDir);
      fs.rmSync(pyZip, { force: true });

      emit({ step: 'pip', label: 'Setting up pip…' });
      patchEmbedPth(pyDir);
      const getpip = path.join(require('os').tmpdir(), 'vc_get-pip.py');
      await download(GETPIP_URL, getpip);
      await run(pyExe, [getpip, '--no-warn-script-location'], {}, (l) =>
        emit({ step: 'pip', label: l.slice(0, 120) }));

      emit({ step: 'deps', label: 'Installing faster-whisper (this can take a few minutes)…', percent: 5 });
      await run(
        pyExe,
        ['-m', 'pip', 'install', '--no-warn-script-location', '--target', pyDir, 'faster-whisper'],
        {},
        (l) => emit({ step: 'deps', label: (l || '').slice(0, 120) })
      );
    }

    emit({ step: 'done', label: 'All components ready.', done: true });
    return status(root);
  } catch (err) {
    emit({ step: 'error', error: String(err.message || err), done: false });
    throw err;
  } finally {
    running = false;
  }
}

function findFileRecursive(dir, regex) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFileRecursive(full, regex);
      if (hit) return hit;
    } else if (regex.test(entry.name) && !/-probe$/i.test(entry.name)) {
      return full;
    }
  }
  return null;
}

module.exports = { locateFfmpeg, locatePython, status, ensure };
