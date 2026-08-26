// src/lib/time.js — timestamp helpers shared across pages.

/** Seconds -> "mm:ss" (or "hh:mm:ss" past an hour). */
export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`;
}

/** Seconds -> "hh:mm:ss" always (for AI prompts / filenames). */
export function fmtHms(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

/** Parse "ss", "mm:ss", "hh:mm:ss(.ms)" -> seconds. Returns NaN on garbage. */
export function parseTime(str) {
  if (str == null || str === '') return NaN;
  if (/^\d+(\.\d+)?$/.test(String(str).trim())) return parseFloat(str);
  const parts = String(str).trim().split(':');
  if (parts.length > 3 || parts.some((p) => p !== '' && isNaN(parseFloat(p)))) return NaN;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + (parseFloat(p) || 0);
  return sec;
}

/** Human readable file size. */
export function fmtSize(bytes) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
