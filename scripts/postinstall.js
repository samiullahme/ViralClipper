// scripts/postinstall.js — best-effort native rebuild of better-sqlite3 for
// Electron's ABI. Never fails the install; electron-builder also rebuilds
// automatically during `npm run dist`, so this only speeds up `npm run dev`.
try {
  const { rebuild } = require('@electron/rebuild');
  const path = require('path');
  console.log('[postinstall] Rebuilding better-sqlite3 for Electron…');
  rebuild({ projectRoot: path.resolve(__dirname, '..'), onlyModules: ['better-sqlite3'] })
    .then(() => console.log('[postinstall] Native module ready.'))
    .catch((e) => {
      console.warn('[postinstall] Skipped:', e.message);
      console.warn('[postinstall] If `npm run dev` complains about better-sqlite3 ABI,');
      console.warn('[postinstall] install VS Build Tools (Windows) and run: npm run rebuild');
    });
} catch (e) {
  console.warn('[postinstall] @electron/rebuild unavailable:', e.message);
}
