// src/components/ClipCard.jsx — one AI-detected clip: thumb, meta, actions.
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { fmtTime, fmtHms, parseTime } from '../lib/time.js';

export default function ClipCard({ clip, onChanged, onDeleted }) {
  const { video, projectId, playRange, toast } = useApp();
  const [thumb, setThumb] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ start: '', end: '' });
  const busy = useRef(false);

  // Lazily extract a mid-clip thumbnail via FFmpeg (cached in main process).
  useEffect(() => {
    let alive = true;
    window.vc.clipThumb(video.path, clip.start, projectId, clip.idx ?? clip.id)
      .then((p) => { if (alive && p) setThumb(window.vc.toMediaUrl(p)); });
    return () => { alive = false; };
  }, [video.path, clip.start, clip.idx, clip.id, projectId]);

  const dur = Math.max(0, clip.end - clip.start);
  const tooLong = dur > 95;

  const saveTimes = () => {
    const s = parseTime(draft.start), e = parseTime(draft.end);
    if (isNaN(s) || isNaN(e) || e <= s) {
      toast('Invalid timestamps. Use mm:ss or hh:mm:ss.', 'error');
      return;
    }
    window.vc.updateClip(clip.id, { start: s, end: e }).then((c) => {
      onChanged?.(c);
      setEditing(false);
      toast('Timestamps updated', 'success');
    });
  };

  const toggleEnabled = () => {
    window.vc.updateClip(clip.id, { enabled: clip.enabled ? 0 : 1 }).then(onChanged);
  };

  const del = async () => {
    if (busy.current) return;
    busy.current = true;
    await window.vc.deleteClip(clip.id).catch(() => {});
    onDeleted?.(clip.id);
    busy.current = false;
  };

  return (
    <div className={`card overflow-hidden transition-opacity ${clip.enabled ? '' : 'opacity-50'}`}>
      {/* Thumbnail */}
      <button
        className="relative block w-full aspect-video bg-neutral-900 group"
        onClick={() => video && playRange(clip.start, clip.end)}
        title="Preview this segment"
      >
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" draggable={false} />
        ) : (
          <div className="skeleton w-full h-full rounded-none" />
        )}
        <span className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100
                         transition-opacity bg-black/40 text-white text-sm">▶ Preview</span>
        <span className={`absolute bottom-2 right-2 chip ${tooLong ? 'bg-orange-600/90 text-white' : 'bg-black/70'}`}>
          {fmtTime(dur)}
        </span>
      </button>

      <div className="p-4 space-y-3">
        {/* Title + times */}
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-100 leading-snug">{clip.title}</h3>
            <label className="flex items-center gap-1.5 cursor-pointer shrink-0 pt-0.5"
              title="Include in export">
              <input type="checkbox" checked={!!clip.enabled} onChange={toggleEnabled}
                className="accent-accent w-4 h-4" />
              <span className="text-xs text-zinc-500">use</span>
            </label>
          </div>
          {editing ? (
            <div className="mt-2 flex items-center gap-2">
              <input className="input py-1 w-24 text-xs" value={draft.start}
                onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))}
                placeholder={fmtHms(clip.start)} />
              <span className="text-zinc-500">→</span>
              <input className="input py-1 w-24 text-xs" value={draft.end}
                onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
                placeholder={fmtHms(clip.end)} />
              <button className="btn-primary px-2.5 py-1 text-xs" onClick={saveTimes}>Save</button>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(false)}>×</button>
            </div>
          ) : (
            <button
              className="mt-1 text-xs text-accent-soft hover:underline"
              onClick={() => {
                setDraft({ start: fmtHms(clip.start), end: fmtHms(clip.end) });
                setEditing(true);
              }}
            >
              {fmtHms(clip.start)} → {fmtHms(clip.end)} · edit
            </button>
          )}
        </div>

        {/* Reason + hook */}
        {clip.reason && <p className="text-xs text-zinc-400 leading-relaxed">{clip.reason}</p>}
        {clip.hook && (
          <p className="text-xs italic text-accent-soft border-l-2 border-accent pl-2">
            “{clip.hook}”
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button className="btn-ghost px-2.5 py-1 text-xs flex-1"
            onClick={() => video && playRange(clip.start, clip.end)}>
            ▶ Preview
          </button>
          <button className="btn-danger px-2.5 py-1 text-xs" onClick={del} title="Delete clip">Delete</button>
        </div>
      </div>
    </div>
  );
}
