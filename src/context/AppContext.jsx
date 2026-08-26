// src/context/AppContext.jsx — global client state + toast system + shared video player control.
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useNavigate } from 'react-router-dom';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const vc = () => window.vc;

export function AppProvider({ children }) {
  const navigate = useNavigate();

  // ---- persisted settings ----------------------------------------------------
  const [settings, setSettings] = useState({
    provider: 'deepseek', hasKey: false, model: '', whisperModel: 'tiny',
    channelName: '', logoPath: '', outputDir: '', ratio: '9:16', quality: '1080',
  });
  const refreshSettings = useCallback(async () => {
    try { setSettings(await vc().getSettings()); } catch { /* ignore */ }
  }, []);
  useEffect(() => { refreshSettings(); }, [refreshSettings]);

  // ---- current project ---------------------------------------------------------
  const [video, setVideo] = useState(null);        // {path,name,size,duration,thumbPath}
  const [projectId, setProjectId] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [clips, setClips] = useState([]);

  const loadProjectIntoApp = useCallback(async (id) => {
    const data = await vc().loadProject(id);
    const p = data.project;
    setProjectId(p.id);
    setVideo({
      path: p.video_path, name: p.video_name,
      size: Number(p.size), duration: Number(p.duration),
      thumbPath: null,
    });
    setTranscript(data.transcript || []);
    setClips(data.clips || []);
    return data;
  }, []);

  const resetProject = useCallback(() => {
    setVideo(null); setProjectId(null); setTranscript([]); setClips([]);
  }, []);

  // ---- shared <video> element control ---------------------------------------------
  const playerRef = useRef(null);
  const [activeRange, setActiveRange] = useState(null); // {start,end}

  const seekTo = useCallback((t) => {
    const el = playerRef.current;
    if (el) { el.currentTime = Math.max(0, t - 0.15); el.play().catch(() => {}); }
  }, []);

  const playRange = useCallback((start, end) => {
    setActiveRange({ start, end });
    const el = playerRef.current;
    if (el) {
      el.currentTime = start;
      el.play().catch(() => {});
    }
  }, []);

  // ---- toasts ------------------------------------------------------------------------
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const value = useMemo(() => ({
    settings, refreshSettings,
    video, setVideo, projectId, setProjectId,
    transcript, setTranscript, clips, setClips,
    loadProjectIntoApp, resetProject,
    playerRef, activeRange, setActiveRange, seekTo, playRange,
    toast, navigate,
  }), [
    settings, refreshSettings, video, projectId, transcript, clips,
    loadProjectIntoApp, resetProject, activeRange, seekTo, playRange, toast, navigate,
  ]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Toast stack (top-right) */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`card px-4 py-3 text-sm shadow-xl border-l-4 ${
              t.type === 'error' ? 'border-l-red-500 text-red-200'
                : t.type === 'success' ? 'border-l-emerald-500 text-emerald-100'
                  : 'border-l-accent text-zinc-200'}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
