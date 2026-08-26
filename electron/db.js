// electron/db.js — SQLite persistence layer (better-sqlite3, synchronous & fast).
// Tables: settings(k,v), projects, clips. All times stored as REAL seconds.
const path = require('path');
const fs = require('fs');
let db = null;

function initDb(dbFile) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const Database = require('better-sqlite3');
  db = new Database(dbFile);
  db.pragma('journal_mode = WAL'); // low memory footprint + crash safety

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      k TEXT PRIMARY KEY,
      v TEXT
    );
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_path TEXT NOT NULL,
      video_name TEXT NOT NULL,
      duration REAL DEFAULT 0,
      size INTEGER DEFAULT 0,
      status TEXT DEFAULT 'new',            -- new | transcribing | transcribed | clipped
      transcript TEXT,                      -- JSON array of {start,end,text}
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS clips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      start REAL NOT NULL,
      end REAL NOT NULL,
      title TEXT,
      reason TEXT,
      hook TEXT,
      headline TEXT,
      subtext TEXT,
      hashtags TEXT,                        -- JSON array of strings
      enabled INTEGER DEFAULT 1
    );
  `);
  return db;
}

// ---- settings -----------------------------------------------------------------
const getSetting = (k) => db.prepare('SELECT v FROM settings WHERE k=?').get(k)?.v ?? null;
const setSetting = (k, v) =>
  db.prepare('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v')
    .run(k, v == null ? null : String(v));
const allSettings = () =>
  Object.fromEntries(db.prepare('SELECT k,v FROM settings').all().map((r) => [r.k, r.v]));

// ---- projects -------------------------------------------------------------------
const createProject = ({ videoPath, videoName, duration, size }) => {
  const r = db
    .prepare('INSERT INTO projects(video_path,video_name,duration,size) VALUES(?,?,?,?)')
    .run(videoPath, videoName, duration || 0, size || 0);
  return Number(r.lastInsertRowid);
};
const getProject = (id) => db.prepare('SELECT * FROM projects WHERE id=?').get(id);
const listProjects = () =>
  db.prepare('SELECT id,video_path,video_name,duration,size,status,created_at FROM projects ORDER BY id DESC LIMIT 20').all();
const deleteProject = (id) => db.prepare('DELETE FROM projects WHERE id=?').run(id);
const setProjectTranscript = (id, segments) =>
  db.prepare("UPDATE projects SET transcript=?, status='transcribed' WHERE id=?")
    .run(JSON.stringify(segments), id);
const setProjectStatus = (id, s) => db.prepare('UPDATE projects SET status=? WHERE id=?').run(s, id);

// ---- clips ------------------------------------------------------------------------
const replaceClips = (projectId, clips) => {
  const tx = db.transaction((list) => {
    db.prepare('DELETE FROM clips WHERE project_id=?').run(projectId);
    const ins = db.prepare(
      'INSERT INTO clips(project_id,idx,start,end,title,reason,hook,headline,subtext,hashtags,enabled)' +
      ' VALUES(?,?,?,?,?,?,?,?,?,?,?)'
    );
    list.forEach((c, i) =>
      ins.run(
        projectId, i, c.start, c.end, c.title || '', c.reason || '', c.hook || '',
        c.headline || '', c.subtext || '',
        JSON.stringify(c.hashtags || []), c.enabled === false ? 0 : 1
      )
    );
  });
  tx(clips);
};
const listClips = (projectId) =>
  db.prepare('SELECT * FROM clips WHERE project_id=? ORDER BY idx ASC').all(projectId)
    .map((c) => ({ ...c, hashtags: JSON.parse(c.hashtags || '[]') }));
const getClip = (id) => {
  const c = db.prepare('SELECT * FROM clips WHERE id=?').get(id);
  return c ? { ...c, hashtags: JSON.parse(c.hashtags || '[]') } : null;
};
const updateClip = (id, patch) => {
  const allowed = ['start', 'end', 'title', 'reason', 'hook', 'headline', 'subtext', 'hashtags', 'enabled'];
  const sets = [], vals = [];
  for (const k of allowed) {
    if (k in patch) {
      sets.push(`${k}=?`);
      vals.push(k === 'hashtags' ? JSON.stringify(patch[k]) : patch[k]);
    }
  }
  if (!sets.length) return;
  db.prepare(`UPDATE clips SET ${sets.join(',')} WHERE id=?`).run(...vals, id);
};
const deleteClip = (id) => db.prepare('DELETE FROM clips WHERE id=?').run(id);

module.exports = {
  initDb,
  getSetting, setSetting, allSettings,
  createProject, getProject, listProjects, deleteProject, setProjectTranscript, setProjectStatus,
  replaceClips, listClips, getClip, updateClip, deleteClip,
};
