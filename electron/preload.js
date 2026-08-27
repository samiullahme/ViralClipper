// electron/preload.js — secure bridge between renderer and main process.
// Exposes a minimal `window.vc` API; no Node APIs leak into the renderer.
const { contextBridge, ipcRenderer } = require('electron');

// Channels the renderer is allowed to subscribe to (progress/result streams).
const EVENT_CHANNELS = new Set([
  'transcribe:progress',
  'transcribe:result',
  'transcribe:error',
  'export:progress',
  'export:item-done',
  'export:done',
  'export:error',
  'preview:progress',
  'preview:done',
  'preview:error',
  'binaries:progress',
  'binaries:status',
  'shift:progress',
  'shift:done',
  'shift:error',
]);

const invoke = (ch, payload) => ipcRenderer.invoke(ch, payload);

contextBridge.exposeInMainWorld('vc', {
  // ---- dialogs -------------------------------------------------------------
  pickVideo: () => invoke('video:pick'),
  ingestDroppedFile: (filePath) => invoke('video:ingest', { filePath }),
  pickFolder: () => invoke('folder:pick'),
  pickLogo: () => invoke('settings:pickLogo'),

  // ---- projects / persistence ----------------------------------------------
  createProject: (info) => invoke('project:create', info),
  loadProject: (id) => invoke('project:load', { id }),
  listProjects: () => invoke('project:list'),
  deleteProject: (id) => invoke('project:delete', { id }),
  saveTranscript: (projectId, segments) =>
    invoke('project:saveTranscript', { projectId, segments }),

  // ---- settings --------------------------------------------------------------
  getSettings: () => invoke('settings:get'),
  setSettings: (pairs) => invoke('settings:set', pairs),
  getVersion: () => invoke('app:version'),

  // ---- transcription (embedded python bridge) ---------------------------------
  startTranscription: (videoPath, durationSec) =>
    invoke('transcribe:start', { videoPath, durationSec }),
  cancelTranscription: () => invoke('transcribe:cancel'),

  // ---- AI ----------------------------------------------------------------------
  detectClips: (projectId) => invoke('ai:detectClips', { projectId }),
  generateCopy: (clipId) => invoke('ai:generateCopy', { clipId }),
  updateClip: (clipId, patch) => invoke('clip:update', { clipId, patch }),
  deleteClip: (clipId) => invoke('clip:delete', { clipId }),
  clipThumb: (videoPath, startSec, projectId, idx) =>
    invoke('clip:thumb', { videoPath, startSec, projectId, idx }),

  // ---- ffmpeg render (editor preview + export queue) ----------------------------
  renderPreview: (payload) => invoke('preview:render', payload),
  cancelPreview: () => invoke('preview:cancel'),
  runExport: (payload) => invoke('export:start', payload),
  cancelExport: () => invoke('export:cancel'),
  applyPositionShift: (filePath) => invoke('shift:apply', { filePath }),

  // ---- misc ---------------------------------------------------------------------
  openPath: (p) => invoke('fs:openPath', { path: p }),
  checkBinaries: () => invoke('binaries:check'),
  installBinaries: () => invoke('binaries:install'),

  /**
   * Subscribe to a main-process event stream.
   * Returns an unsubscribe function.
   */
  on(channel, cb) {
    if (!EVENT_CHANNELS.has(channel)) throw new Error(`Blocked channel: ${channel}`);
    const handler = (_e, data) => cb(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  /** Convert an absolute file path into a vc:// URL usable in <img>/<video>. */
  toMediaUrl(absPath) {
    if (!absPath) return null;
    const parts = String(absPath).split(/[\\/]+/).filter(Boolean);
    return 'vc:///' + parts.map(encodeURIComponent).join('/');
  },
});
