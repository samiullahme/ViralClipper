// electron/ipcHandlers.js — every IPC endpoint used by the renderer.
//
// Sections: dialogs · video info/thumbs · projects · settings (encrypted API key)
//           transcription bridge · AI clip detection/copywriting
//           editor previews · export queue · binaries · misc.
const { ipcMain, dialog, shell, safeStorage, app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const db = require('./db');
const ai = require('./ai');
const { buildArgs } = require('./ffmpeg');
const binaries = require('./binaries');
const positionshift = require('./positionshift');

let P;                 // resolved paths (injected from main.js)
let getWindow = () => null;
let transcribeProc = null;
let exportState = null; // { cancelRequested }
let previewProc = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "HH:MM:SS(.ms)" / "MM:SS" / "12.5" into seconds. */
function toSeconds(v) {
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(':').map((x) => parseFloat(x) || 0);
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return sec;
}

/** Sanitize a string for use in filenames. */
function safeName(s, max = 60) {
  return String(s || 'clip')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, max) || 'clip';
}

/** Encrypt text with OS-level protection (DPAPI on Windows); fallback base64. */
function protectSecret(plain) {
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(plain).toString('base64');
  }
  return 'plain:' + Buffer.from(plain, 'utf8').toString('base64'); // dev fallback
}
function revealSecret(stored) {
  if (!stored) return null;
  if (stored.startsWith('enc:')) {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
  }
  if (stored.startsWith('plain:')) {
    return Buffer.from(stored.slice(6), 'base64').toString('utf8');
  }
  return stored;
}

/** Get effective AI credentials from settings. */
function aiCredentials() {
  const provider = db.getSetting('provider') || 'deepseek';
  return {
    provider,
    apiKey: revealSecret(db.getSetting('api_key_enc')),
    model: db.getSetting(`model_${provider}`) || undefined,
  };
}

/** Spawn ffmpeg; streams "-progress pipe:1" output as percent of totalSec. */
function spawnFfmpeg(args, totalSec, onPercent) {
  const child = spawn(binaries.locateFfmpeg(P.root), args, { windowsHide: true });
  let errTail = '';
  child.stderr.on('data', (d) => { errTail = (errTail + d.toString()).slice(-1500); });
  child.stdout.on('data', (d) => {
    const s = d.toString();
    const re = /out_time_us=(\d+)/g;
    let m, last = null;
    while ((m = re.exec(s))) last = Number(m[1]) / 1e6;
    if (last != null && totalSec > 0 && onPercent) {
      onPercent(Math.min(99, Math.round((last / totalSec) * 100)));
    }
  });
  child._errTail = () => errTail;
  return child;
}

/** Wait for an already-spawned ffmpeg child; reject on non-zero exit. */
function waitFfmpeg(child) {
  return new Promise((resolve, reject) => {
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}. ${child._errTail()}`)));
    child.on('error', reject);
  });
}

/**
 * Apply the "Position Shift" drifting effect to an already-trimmed clip.
 * Rewrites `filePath` in place (via a temp file + atomic rename so a cancelled
 * run never leaves a half-finished clip at the target path).
 */
async function applyPositionShift(input, duration, onPercent) {
  const ff = binaries.locateFfmpeg(P.root);
  const info = await positionshift.probe(input, ff);
  const tmp = path.join(os.tmpdir(), `vc_shift_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
  const { args } = positionshift.buildShiftArgs({
    input, output: tmp, W: info.w, H: info.h, duration, seed: Date.now(),
  });
  const child = spawnFfmpeg(args, info.duration, onPercent);
  try {
    await waitFfmpeg(child);
    fs.renameSync(tmp, input); // atomic replace
    return input;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Extract a jpeg thumbnail at t seconds; returns cached file path. */
async function extractThumb(videoPath, atSec, cacheName, width = 480) {
  const out = path.join(P.thumbsDir, `${cacheName}.jpg`);
  if (fs.existsSync(out)) return out;
  const ff = binaries.locateFfmpeg(P.root);
  await new Promise((resolve, reject) => {
    const c = spawn(ff, [
      '-hide_banner', '-nostats',
      '-ss', String(Math.max(0, atSec)),
      '-i', videoPath,
      '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4',
      '-y', out,
    ], { windowsHide: true });
    let tail = '';
    c.stderr.on('data', (d) => { tail += d.toString(); });
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(tail.slice(-300)))));
    c.on('error', reject);
  });
  return out;
}

/** Probe duration/size via `ffmpeg -i` stderr (no ffprobe needed). */
function probeDuration(ff, videoPath) {
  return new Promise((resolve) => {
    let dur = 0;
    const c = spawn(ff, ['-hide_banner', '-i', videoPath], { windowsHide: true });
    c.stderr.on('data', (d) => {
      const m = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(d.toString());
      if (m) dur = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    });
    c.on('close', () => resolve(dur));
    c.on('error', () => resolve(0));
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

function registerIpcHandlers(paths, windowGetter) {
  P = paths;
  getWindow = windowGetter;
  const send = (ch, data) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(ch, data);
  };

  // ---- dialogs --------------------------------------------------------------
  /** Shared pipeline: stat + probe duration + thumbnail for a video path. */
  const ingestVideoPath = async (videoPath) => {
    const stat = fs.statSync(videoPath);
    const ff = binaries.locateFfmpeg(P.root);
    if (!ff) throw new Error('FFmpeg is not ready yet. Open Settings → Components and install it.');
    const duration = await probeDuration(ff, videoPath);
    const hash = crypto.createHash('md5').update(videoPath + stat.mtimeMs).digest('hex').slice(0, 16);
    let thumbPath = null;
    try { thumbPath = await extractThumb(videoPath, Math.min(3, duration / 2 || 1), hash); }
    catch { thumbPath = null; } // some codecs fail; UI falls back to a gradient tile
    return {
      path: videoPath,
      name: path.basename(videoPath),
      size: stat.size,
      duration,
      thumbPath,
    };
  };

  ipcMain.handle('video:pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose a video',
      filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return null;
    return ingestVideoPath(filePaths[0]);
  });

  /** Drag & drop support: renderer passes the absolute dropped path. */
  ipcMain.handle('video:ingest', (_e, { filePath }) => {
    if (!filePath || !fs.existsSync(filePath)) throw new Error('File not found.');
    return ingestVideoPath(filePath);
  });

  ipcMain.handle('folder:pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose output folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return canceled ? null : filePaths[0];
  });

  // ---- projects ---------------------------------------------------------------
  ipcMain.handle('project:create', (_e, info) =>
    db.createProject({
      videoPath: info.path, videoName: info.name,
      duration: info.duration, size: info.size,
    }));

  ipcMain.handle('project:load', (_e, { id }) => {
    const project = db.getProject(id);
    if (!project) throw new Error('Project not found.');
    return {
      project,
      transcript: project.transcript ? JSON.parse(project.transcript) : [],
      clips: db.listClips(id),
    };
  });

  ipcMain.handle('project:list', () => db.listProjects());
  ipcMain.handle('project:delete', (_e, { id }) => db.deleteProject(id));

  ipcMain.handle('project:saveTranscript', (_e, { projectId, segments }) => {
    db.setProjectTranscript(projectId, segments);
    return true;
  });

  // ---- settings ---------------------------------------------------------------
  ipcMain.handle('settings:get', () => ({
    provider: db.getSetting('provider') || 'deepseek',
    hasKey: !!db.getSetting('api_key_enc'),
    model: db.getSetting(`model_${db.getSetting('provider') || 'deepseek'}`) || '',
    whisperModel: db.getSetting('whisper_model') || 'tiny',
    channelName: db.getSetting('channel_name') || '',
    logoPath: db.getSetting('logo_path') || '',
    outputDir: db.getSetting('output_dir') || '',
    ratio: db.getSetting('ratio') || '9:16',
    quality: db.getSetting('quality') || '1080',
  }));

  ipcMain.handle('settings:set', (_e, pairs) => {
    for (const [k, v] of Object.entries(pairs || {})) {
      if (k === 'api_key') {
        db.setSetting('api_key_enc', v ? protectSecret(String(v)) : '');
      } else if (k === 'model') {
        db.setSetting(`model_${db.getSetting('provider') || 'deepseek'}`, v);
      } else {
        db.setSetting(k, v);
      }
    }
    return true;
  });

  ipcMain.handle('settings:pickLogo', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose channel logo PNG',
      filters: [{ name: 'PNG image', extensions: ['png'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return null;
    fs.copyFileSync(filePaths[0], P.logoFile);
    db.setSetting('logo_path', P.logoFile);
    return P.logoFile;
  });

  // ---- transcription bridge ------------------------------------------------------
  ipcMain.handle('transcribe:start', (_e, { videoPath, durationSec }) => {
    const pyExe = binaries.locatePython(P.root);
    if (!pyExe) throw new Error('Embedded Python is not installed yet. See Settings → Components.');
    if (!fs.existsSync(P.transcribeScript)) throw new Error('transcribe.py is missing.');
    if (transcribeProc) throw new Error('A transcription is already running.');

    const modelSize = db.getSetting('whisper_model') === 'base' ? 'base' : 'tiny';
    transcribeProc = spawn(pyExe, [P.transcribeScript, videoPath, modelSize, String(durationSec || 0)], {
      cwd: P.pythonDir,
      windowsHide: true,
      env: { ...process.env, PYTHONPATH: P.pythonDir, PYTHONDONTWRITEBYTECODE: '1' },
    });

    send('binaries:status', binaries.status(P.root));

    let buf = '';
    transcribeProc.stdout.on('data', (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'progress') send('transcribe:progress', msg);
          else if (msg.type === 'result') send('transcribe:result', msg.segments);
          else if (msg.type === 'error') send('transcribe:error', msg.message);
        } catch { /* ignore non-JSON noise */ }
      }
    });
    transcribeProc.stderr.on('data', (d) => {
      const line = d.toString().slice(0, 160);
      send('transcribe:progress', { type: 'log', line });
    });
    transcribeProc.on('exit', (code) => {
      transcribeProc = null;
      if (code !== 0) send('transcribe:error', `Transcription exited with code ${code}`);
    });

    return { started: true, model: modelSize };
  });

  ipcMain.handle('transcribe:cancel', () => {
    if (transcribeProc) transcribeProc.kill();
    transcribeProc = null;
    return true;
  });

  // ---- AI --------------------------------------------------------------------------
  ipcMain.handle('ai:detectClips', async (_e, { projectId }) => {
    const project = db.getProject(projectId);
    if (!project?.transcript) throw new Error('Run transcription first.');
    const creds = aiCredentials();
    const raw = await ai.detectClips({ ...creds, segments: JSON.parse(project.transcript) });
    const clips = raw
      .map((c) => ({ ...c, start: toSeconds(c.start), end: toSeconds(c.end) }))
      .filter((c) => c.end > c.start)
      .map((c) => ({ ...c, end: Math.min(c.end, project.duration || c.end) }));
    if (!clips.length) throw new Error('AI returned no usable clips. Try again.');
    db.replaceClips(projectId, clips);
    db.setProjectStatus(projectId, 'clipped');
    return db.listClips(projectId);
  });

  ipcMain.handle('ai:generateCopy', async (_e, { clipId }) => {
    const clip = db.getClip(clipId);
    if (!clip) throw new Error('Clip not found.');
    const creds = aiCredentials();
    const copy = await ai.generateCopy({ ...creds, title: clip.title, hook: clip.hook });
    db.updateClip(clipId, copy);
    return db.getClip(clipId);
  });

  ipcMain.handle('clip:update', (_e, { clipId, patch }) => {
    db.updateClip(clipId, patch);
    return db.getClip(clipId);
  });
  ipcMain.handle('clip:delete', (_e, { clipId }) => {
    db.deleteClip(clipId);
    return true;
  });

  ipcMain.handle('clip:thumb', async (_e, { videoPath, startSec, projectId, idx }) => {
    try {
      return await extractThumb(videoPath, startSec + 1, `p${projectId}_c${idx}`, 320);
    } catch {
      return null;
    }
  });

  // ---- editor preview (fast low-res render) ------------------------------------------
  ipcMain.handle('preview:render', async (_e, payload) => {
    if (previewProc) throw new Error('A preview is already rendering.');
    const { videoPath, clip, options, ratio } = payload;
    const texts = {
      headline: clip.headline || '',
      subtext: clip.subtext || '',
      hashtags: Array.isArray(clip.hashtags) ? clip.hashtags : [],
    };
    const outBase = `preview_${Date.now()}.mp4`;
    const out = path.join(P.previewsDir, outBase);
    const { args, tmpFiles } = buildArgs({
      input: videoPath, output: out,
      start: clip.start, end: clip.end,
      ratio: ratio || '9:16', quality: 'preview',
      speed: options.speed, jumpcut: options.jumpcut,
      segLen: options.segLen,
      overlayFrame: options.overlayFrame !== false,
      framePath: P.frameOverlay,
      logoPath: options.logoOn ? P.logoFile : null,
      texts,
    });
    const dur = Math.max(0.5, clip.end - clip.start) / (options.speed || 1.2);
    previewProc = spawnFfmpeg(args, dur, (pct) => send('preview:progress', { percent: pct }));
    try {
      await waitFfmpeg(previewProc);
      send('preview:done', { path: out });
      return { path: out };
    } catch (err) {
      send('preview:error', String(err.message || err));
      throw err;
    } finally {
      tmpFiles.forEach((f) => fs.rmSync(f, { force: true }));
      previewProc = null;
    }
  });
  ipcMain.handle('preview:cancel', () => {
    if (previewProc) previewProc.kill();
    previewProc = null;
    return true;
  });

  // ---- export queue --------------------------------------------------------------------
  ipcMain.handle('export:start', async (_e, payload) => {
    if (exportState) throw new Error('An export is already running.');
    const { videoPath, clips, options, ratio, quality, outDir, channel } = payload;
    if (!outDir || !fs.existsSync(outDir)) throw new Error('Pick a valid output folder first.');
    if (!clips.length) throw new Error('No enabled clips to export.');
    exportState = { cancelRequested: false };

    const date = new Date().toISOString().slice(0, 10);
    const outputs = [];
    const used = new Set();

    for (let i = 0; i < clips.length; i++) {
      if (exportState.cancelRequested) break;
      const clip = clips[i];
      let base = `${safeName(channel || 'channel')}_${safeName(clip.title)}_${date}`;
      let out = path.join(outDir, `${base}.mp4`);
      let n = 2;
      while (used.has(out.toLowerCase()) || fs.existsSync(out)) {
        out = path.join(outDir, `${base}_${n++}.mp4`);
      }
      used.add(out.toLowerCase());

      const texts = {
        headline: clip.headline || '',
        subtext: clip.subtext || '',
        hashtags: Array.isArray(clip.hashtags) ? clip.hashtags : [],
      };
      const { args, tmpFiles } = buildArgs({
        input: videoPath, output: out,
        start: clip.start, end: clip.end,
        ratio, quality: Number(quality) || 1080,
        speed: options.speed, jumpcut: options.jumpcut,
        segLen: options.segLen,
        overlayFrame: options.overlayFrame !== false,
        framePath: P.frameOverlay,
        logoPath: options.logoOn ? P.logoFile : null,
        texts,
      });
      const dur = Math.max(0.5, clip.end - clip.start) / (options.speed || 1.2);
      send('export:progress', { index: i, total: clips.length, title: clip.title, percent: 0, stage: 'rendering' });
      const child = spawnFfmpeg(args, dur, (pct) =>
        send('export:progress', { index: i, total: clips.length, title: clip.title, percent: pct }));
      try {
        await waitFfmpeg(child);
        if (options.positionShift) {
          send('export:progress', { index: i, total: clips.length, title: clip.title, percent: 99, stage: 'shifting' });
          try {
            await applyPositionShift(out, dur, (pct) =>
              send('export:progress', { index: i, total: clips.length, title: clip.title, percent: 99, stage: 'shifting' }));
          } catch (shiftErr) {
            send('export:error', { index: i, message: `Position-shift failed: ${String(shiftErr.message || shiftErr)}` });
            exportState = null;
            throw shiftErr;
          }
        }
        outputs.push(out);
        send('export:item-done', { index: i, path: out });
      } catch (err) {
        if (exportState.cancelRequested) break;
        send('export:error', { index: i, message: String(err.message || err) });
        exportState = null;
        throw err;
      } finally {
        tmpFiles.forEach((f) => fs.rmSync(f, { force: true }));
      }
    }
    exportState = null;
    send('export:done', { outputs, canceled: false });
    return { outputs };
  });

  ipcMain.handle('export:cancel', () => {
    if (exportState) exportState.cancelRequested = true;
    return true;
  });

  // ---- position-shift (single standalone pass on an existing clip) ---------------
  ipcMain.handle('shift:apply', async (_e, { filePath }) => {
    if (!filePath || !fs.existsSync(filePath)) throw new Error('Pick a valid video file first.');
    const ff = binaries.locateFfmpeg(P.root);
    const info = await positionshift.probe(filePath, ff);
    const out = path.join(P.previewsDir, `shift_${Date.now()}.mp4`);
    const { args } = positionshift.buildShiftArgs({
      input: filePath, output: out, W: info.w, H: info.h, duration: info.duration, seed: Date.now(),
    });
    const child = spawnFfmpeg(args, info.duration, (pct) => send('shift:progress', { percent: pct }));
    try {
      await waitFfmpeg(child);
      send('shift:done', { path: out });
      return { path: out };
    } catch (err) {
      send('shift:error', String(err.message || err));
      throw err;
    }
  });

  // ---- binaries & misc ----------------------------------------------------------------------
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('binaries:check', () => binaries.status(P.root));
  ipcMain.handle('binaries:install', async () => {
    send('binaries:status', binaries.status(P.root));
    return binaries.ensure((s) => {
      send('binaries:progress', s);
      if (s.done || s.error) send('binaries:status', binaries.status(P.root));
    }, P.root);
  });

  ipcMain.handle('fs:openPath', async (_e, { path: p }) => {
    if (p && fs.existsSync(p)) await shell.openPath(p);
    else await shell.openPath(os.tmpdir());
    return true;
  });
}

/** Kill all child processes on app quit. */
function shutdown() {
  try { transcribeProc?.kill(); } catch { /* noop */ }
  try { previewProc?.kill(); } catch { /* noop */ }
  try { if (exportState) exportState.cancelRequested = true; } catch { /* noop */ }
}

module.exports = { registerIpcHandlers, shutdown };
