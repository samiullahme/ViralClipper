// src/components/VideoPlayer.jsx — the single shared <video> element.
// Registered into AppContext so every page can seek/play segments of the
// currently loaded project video. Also enforces activeRange stop points.
import React, { useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { fmtTime } from '../lib/time.js';

export default function VideoPlayer() {
  const { video, playerRef, activeRange, setActiveRange } = useApp();

  // Stop playback when the active preview range ends.
  useEffect(() => {
    const el = playerRef.current;
    if (!el) return undefined;
    const onTime = () => {
      if (activeRange && el.currentTime >= activeRange.end) {
        el.pause();
        setActiveRange(null);
      }
    };
    el.addEventListener('timeupdate', onTime);
    return () => el.removeEventListener('timeupdate', onTime);
  }, [activeRange, playerRef, setActiveRange]);

  if (!video) return null;
  return (
    <div className="relative bg-black rounded-xl overflow-hidden">
      <video
        ref={playerRef}
        src={window.vc.toMediaUrl(video.path)}
        controls
        className="w-full max-h-[46vh] bg-black"
      />
      <div className="absolute top-2 right-2 chip bg-black/70 pointer-events-none">
        {fmtTime(playerRef.current?.currentTime || 0)}
      </div>
    </div>
  );
}
