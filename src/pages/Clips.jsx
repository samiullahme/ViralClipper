// src/pages/Clips.jsx — review AI-found clips: preview, tweak times, toggle, delete.
import React, { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import ClipCard from '../components/ClipCard.jsx';

export default function Clips() {
  const { clips, setClips, video, transcript, toast, navigate } = useApp();
  const [bulkBusy, setBulkBusy] = useState(false);

  const selectedCount = clips.filter((c) => c.enabled).length;

  const setBulk = async (enabled) => {
    setBulkBusy(true);
    try {
      const updated = await Promise.all(
        clips.map((c) => window.vc.updateClip(c.id, { enabled: enabled ? 1 : 0 }))
      );
      setClips(updated);
    } finally {
      setBulkBusy(false);
    }
  };

  const onChanged = (clip) =>
    setClips((cs) => cs.map((c) => (c.id === clip.id ? clip : c)));
  const onDeleted = (id) => setClips((cs) => cs.filter((c) => c.id !== id));

  if (!clips.length) {
    return (
      <div className="p-12 text-center space-y-3">
        <p className="text-zinc-400">
          {transcript.length
            ? 'No clips yet — run AI detection on the Transcribe page.'
            : 'Load a video and transcribe it first.'}
        </p>
        <button className="btn-primary" onClick={() => navigate(transcript.length ? '/transcribe' : '/')}>
          {transcript.length ? 'Back to Transcribe' : 'Go to Home'}
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Viral clips</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {selectedCount} of {clips.length} selected for export · {video?.name}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost text-xs" onClick={() => setBulk(true)} disabled={bulkBusy}>Select all</button>
          <button className="btn-ghost text-xs" onClick={() => setBulk(false)} disabled={bulkBusy}>Deselect all</button>
          <button
            className="btn-primary"
            disabled={!selectedCount}
            onClick={() => {
              if (!selectedCount) { toast('Enable at least one clip first.', 'error'); return; }
              navigate('/editor');
            }}
          >
            Continue to Editor →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {clips.map((c) => (
          <ClipCard key={c.id} clip={c} onChanged={onChanged} onDeleted={onDeleted} />
        ))}
      </div>
    </div>
  );
}
