// src/pages/Home.jsx — load a video (drag & drop or browse), see recent projects.
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import VideoPlayer from '../components/VideoPlayer.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import { fmtSize, fmtTime } from '../lib/time.js';

export default function Home() {
  const { video, setVideo, projectId, setProjectId, transcript, setTranscript,
    clips, setClips, resetProject, toast, navigate, loadProjectIntoApp } = useApp();

  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState([]);
  const [binsReady, setBinsReady] = useState(true);
  const dropRef = useRef(null);

  const refreshProjects = () => window.vc.listProjects().then(setProjects).catch(() => {});
  useEffect(() => {
    refreshProjects();
    const off = window.vc.on('binaries:status', (s) =>
      setBinsReady(!!(s.ffmpeg && s.python)));
    return off;
  }, []);

  /** Browse button → native dialog (main returns probed info). */
  const browse = async () => {
    setLoading(true);
    try {
      const info = await window.vc.pickVideo();
      if (!info) return;
      const id = await window.vc.createProject(info);
      setVideo(info);
      setProjectId(id);
      setTranscript([]);
      setClips([]);
      refreshProjects();
      toast('Video loaded. Ready to transcribe.', 'success');
    } catch (e) {
      toast(String(e.message || e), 'error');
    } finally {
      setLoading(false);
    }
  };

  /** Drag & drop handler — asks the user to confirm the dropped path via dialog-free flow. */
  const onDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    // Chromium File.path exposes the absolute path in Electron renderer.
    const filePath = file.path;
    if (!/\.(mp4|mkv|mov|avi|webm|m4v)$/i.test(filePath || '')) {
      toast('Please drop a video file (mp4, mkv, mov, avi).', 'error');
      return;
    }
    setLoading(true);
    try {
      // Reuse the same probe/thumb pipeline through a dedicated IPC call:
      const info = await window.vc.ingestDroppedFile(filePath);
      const id = await window.vc.createProject(info);
      setVideo(info);
      setProjectId(id);
      setTranscript([]);
      setClips([]);
      refreshProjects();
      toast('Video loaded.', 'success');
    } catch (err) {
      toast(String(err.message || err), 'error');
    } finally {
      setLoading(false);
    }
  };

  const resume = async (p) => {
    try {
      await loadProjectIntoApp(p.id);
      toast(`Resumed “${p.video_name}”`, 'success');
      navigate(p.status === 'new' ? '/transcribe'
        : p.status === 'transcribed' ? '/clips' : '/editor');
    } catch (e) {
      toast(String(e.message || e), 'error');
    }
  };

  const canStart = video && binsReady;

  return (
    <div className="p-8 max-w-5xl mx-auto pb-20">
      <h1 className="text-2xl font-bold text-white mb-6">Turn one long video into viral shorts</h1>

      {!video ? (
        /* ---------- Drop zone ---------- */
        <div
          ref={dropRef}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={browse}
          className={`card border-2 border-dashed cursor-pointer transition-colors
            ${dragOver ? 'border-accent bg-accent/10' : 'border-edge hover:border-zinc-600'}
            py-20 flex flex-col items-center gap-4 text-center`}
        >
          {loading ? (
            <>
              <ProgressBar indeterminate small />
              <p className="text-sm text-zinc-400">Probing video & grabbing thumbnail…</p>
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                className="w-14 h-14 text-accent">
                <path d="M12 16V4m0 0L7 9m5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" strokeLinecap="round" />
              </svg>
              <div>
                <p className="text-white font-medium">Drop a video here or click to browse</p>
                <p className="text-xs text-zinc-500 mt-1">mp4 · mkv · mov · avi — processed locally, never uploaded</p>
              </div>
            </>
          )}
        </div>
      ) : (
        /* ---------- Loaded video ---------- */
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_260px] gap-5 items-start">
            <div className="card overflow-hidden">
              <VideoPlayer />
              <div className="p-4 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{video.name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {fmtTime(video.duration)} · {fmtSize(video.size)}
                  </p>
                </div>
                <button className="btn-ghost text-xs shrink-0 ml-3"
                  onClick={() => { resetProject(); }}>
                  Change video
                </button>
              </div>
            </div>

            <div className="card p-5 space-y-3">
              <h2 className="label !mb-0">Next step</h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Transcribe the audio locally with faster-whisper ({'tiny'} model), then let AI find the viral moments.
              </p>
              <button
                className={`btn-primary w-full ${canStart ? '' : 'opacity-40 pointer-events-none'}`}
                onClick={() => navigate('/transcribe')}
              >
                Start Transcription →
              </button>
              {!binsReady && (
                <p className="text-xs text-orange-300">
                  Components still downloading… check Settings.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------- Recent projects ---------- */}
      <h2 className="text-lg font-semibold text-white mt-12 mb-4">Recent projects</h2>
      {!projects.length ? (
        <p className="text-sm text-zinc-500">No projects yet — load your first video above.</p>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div key={p.id} className="card p-4 flex items-center gap-3 group">
              <div className="w-16 h-10 rounded-md bg-neutral-800 grid place-items-center shrink-0">
                <span className="text-[10px] text-zinc-500">{fmtTime(p.duration)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 truncate">{p.video_name}</p>
                <p className="text-[11px] text-zinc-500 capitalize">{p.status} · {p.created_at?.slice(0, 10)}</p>
              </div>
              <button className="btn-primary px-3 py-1.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => resume(p)}>
                Open
              </button>
              <button className="btn-ghost px-2 py-1.5 text-xs"
                title="Delete project"
                onClick={async () => {
                  await window.vc.deleteProject(p.id);
                  if (projectId === p.id) resetProject();
                  refreshProjects();
                }}>
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
