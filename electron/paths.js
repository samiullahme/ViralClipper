// electron/paths.js — central path resolution for portable layout.
//
// Final portable folder looks like:
//   app.exe  ffmpeg.exe  python/  resources/  db/
// "root" is the folder containing app.exe. In dev it is the project folder.
const path = require('path');
const { app } = require('electron');

/** Root dir: where the exe lives (or PORTABLE_EXECUTABLE_DIR for true portable target). */
function getRootDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (app.isPackaged) return path.dirname(app.getPath('exe'));
  return app.getAppPath(); // dev: project root
}

/** Packaged resources dir (contains frame_overlay.png / app.ico). */
function getResourcesDir() {
  if (app.isPackaged) return process.resourcesPath;
  return path.join(getRootDir(), 'resources');
}

/** All long-lived data lives under root/db + OS cache dirs. */
function buildPaths() {
  const root = getRootDir();
  const userData = app.getPath('userData');
  return {
    root,
    dbDir: path.join(root, 'db'),
    dbFile: path.join(root, 'db', 'database.sqlite'),
    resources: getResourcesDir(),
    frameOverlay: path.join(getResourcesDir(), 'frame_overlay.png'),
    // Writable caches kept out of the portable folder to keep it clean.
    thumbsDir: path.join(userData, 'thumbs'),
    previewsDir: path.join(userData, 'previews'),
    tmpDir: path.join(userData, 'tmp'),
    logoFile: path.join(userData, 'channel_logo.png'),
    transcribeScript: path.join(root, 'python', 'transcribe.py'),
    pythonDir: path.join(root, 'python'),
  };
}

module.exports = { getRootDir, getResourcesDir, buildPaths };
