// src/pages/Transcribe.jsx — run embedded-python whisper transcription,
// show live progress, clickable timestamped transcript, then AI clip detection.
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import { fmtTime } from '../lib/time.js';

export default function Transcribe() {
  const { video, projectId, transcript, setTranscript, clips, setClips, settings,
    playerRef, seekTo, toast, navigate } = useApp();

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusLine, setStatusLine] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const listRef = useRef(null);
  // Nonce = which video this page is currently operating on, so a
  // transcribe:result from a previous/other project can never leak into view.
  const [videoPath, setVideoPath] = useState(null);

  // Reset transcription state whenever the loaded video changes.
  useEffect(() => {
    setVideoPath(video?.path || null);
    setRunning(false);
    setProgress(0);
    setStatusLine('');
  }, [video?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start when arriving with an untranscribed video.
  useEffect(() => {
    if (video && videoPath === video.path && transcript.length === 0 && !running && progress === 0) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, videoPath, transcript.length]);

  // Subscribe to the python process event stream.
  useEffect(() => {
    const offs = [
      window.vc.on('transcribe:progress', (m) => {
        if (typeof m.progress === 'number') setProgress(m.progress);
        if (m.line) setStatusLine(m.line);
      }),
      window.vc.on('transcribe:result', async (segments) => {
        // Ignore results that arrive after the user switched projects/videos,
        // otherwise an old project's segments could overwrite the current one.
        if (!projectId) return;
        setRunning(false);
        setProgress(100);
        setTranscript(segments);
        await window.vc.saveTranscript(projectId, segments);
        toast('Transcription complete.', 'success');
      }),
      window.vc.on('transcribe:error', (msg) => {
        setRunning(false);
        toast(String(msg), 'error');
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [projectId, setTranscript, toast]);

  // Highlight the transcript line matching playhead.
  useEffect(() => {
    if (!transcript.length) return undefined;
    const iv = setInterval(() => {
      const t = playerRef.current?.currentTime;
      if (t == null) return;
      let idx = -1;
      for (let i = 0; i < transcript.length; i++) {
        if (t >= transcript[i].start - 0.2 && t < transcript[i].end + 0.3) { idx = i; break; }
      }
      setActiveIdx(idx);
    }, 300);
    return () => clearInterval(iv);
  }, [transcript, playerRef]);

  const start = async () => {
    if (!video || running) return;
    setRunning(true);
    setProgress(1);
    try {
      await window.vc.startTranscription(video.path, video.duration);
    } catch (e) {
      setRunning(false);
      toast(String(e.message || e), 'error');
    }
  };

  const findClips = async () => {
    if (!settings.hasKey) {
      toast(`Add your ${settings.provider} API key in Settings first.`, 'error');
      return;
    }
    setDetecting(true);
    try {
      const clips = await window.vc.detectClips(projectId);
      setClips(clips);
      toast(`${clips.length} viral clips found!`, 'success');
      navigate('/clips');
    } catch (e) {
      toast(String(e.message || e), 'error');
    } finally {
      setDetecting(false);
    }
  };

  if (!video) {
    return (
      <div className="p-12 text-center space-y-3">
        <p className="text-zinc-400">No video loaded.</p>
        <button className="btn-primary" onClick={() => navigate('/')}>Go to Home</button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Transcribe</h1>
        <span className="chip capitalize">whisper {settings.whisperModel} · local</span>
      </div>

      {/* Progress card */}
      {(running || progress > 0) && (
        <div className="card p-5 mb-6">
          <ProgressBar value={progress} label={running ? 'Transcribing…' : 'Done'} />
          {statusLine && running && (
            <p className="mt-2 text-[11px] text-zinc-600 truncate">{statusLine}</p>
          )}
          {running && (
            <button className="btn-ghost mt-3 text-xs" onClick={() => window.vc.cancelTranscription()}>
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Transcript */}
      {transcript.length > 0 ? (
        <>
          <div className="card divide-y divide-edge/60 max-h-[52vh] overflow-y-auto" ref={listRef}>
            {transcript.map((seg, i) => (
              <button
                key={i}
                onClick={() => seekTo(seg.start)}
                className={`w-full text-left px-4 py-2.5 flex gap-3 items-baseline transition-colors
                  ${i === activeIdx ? 'bg-accent/15' : 'hover:bg-neutral-800/60'}`}
              >
                <span className="text-xs text-accent-soft font-mono shrink-0 w-28">
                  [{fmtTime(seg.start)} - {fmtTime(seg.end)}]
                </span>
                <span className="text-sm text-zinc-300">{seg.text}</span>
              </button>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-3">
            <button className="btn-primary px-6 py-3" onClick={findClips} disabled={detecting}>
              {detecting ? 'Analyzing…' : '✨ Find Viral Clips with AI'}
            </button>
            {detecting && <ProgressBar indeterminate small />}
          </div>
          {detecting && (
            <div className="grid grid-cols-3 gap-4 mt-6">
              {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-32" />)}
            </div>
          )}
        </>
      ) : (
        !running && (
          <div className="text-center py-16 space-y-4">
            <p className="text-zinc-400">No transcript yet.</p>
            <button className="btn-primary" onClick={start}>Run Transcription</button>
          </div>
        )
      )}
    </div>
  );
}
