// src/components/Sidebar.jsx — left navigation with step gating + component status dot.
import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';

/* Tiny inline SVG icon set (no icon library needed). */
const icons = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  wave: 'M4 12h2l2-6 3 12 3-9 2 3h4',
  cut: 'M6 4l12 12M18 4L6 16M7.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm9 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  wand: 'M15 4V2m0 20v-2M8.5 8.5 7 7m10 10 1.5 1.5M4 15H2m20-6h-2M7 17l-1.5 1.5M17 7l1.5-1.5M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  up: 'M12 19V5m0 0-6 6m6-6 6 6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6c-.1.4-.1.8-.1 1.2s0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
};

function Icon({ d }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0">
      <path d={d} />
    </svg>
  );
}

export default function Sidebar() {
  const { video, transcript, clips, settings } = useApp();
  const [binStatus, setBinStatus] = useState(null);

  // Track ffmpeg/python availability for the footer indicator.
  useEffect(() => {
    let off;
    const poll = () => window.vc?.checkBinaries?.().then(setBinStatus).catch(() => {});
    poll();
    if (window.vc) off = window.vc.on('binaries:status', () => poll());
    return off;
  }, []);

  const items = [
    { to: '/', label: 'Home', icon: icons.home, enabled: true },
    { to: '/transcribe', label: 'Transcribe', icon: icons.wave, enabled: !!video },
    { to: '/clips', label: 'Clips', icon: icons.cut, enabled: transcript.length > 0 },
    { to: '/editor', label: 'Editor', icon: icons.wand, enabled: clips.length > 0 },
    { to: '/export', label: 'Export', icon: icons.up, enabled: clips.some((c) => c.enabled) },
    { to: '/settings', label: 'Settings', icon: icons.gear, enabled: true },
  ];

  const ready = binStatus && binStatus.ffmpeg && binStatus.python;

  return (
    <aside className="w-56 shrink-0 border-r border-edge bg-panel flex flex-col">
      {/* Brand */}
      <div className="px-5 py-5 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-accent grid place-items-center text-white font-black">V</div>
        <div>
          <div className="text-white font-bold leading-tight">ViralClipper</div>
          <div className="text-[11px] text-zinc-500 -mt-0.5">long → viral shorts</div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1 mt-2">
        {items.map((it) => {
          const cls = `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
            it.enabled ? '' : 'text-zinc-600 cursor-not-allowed'
          }`;
          // Disabled steps render as inert buttons (NavLink needs a real `to`).
          if (!it.enabled) {
            return (
              <button key={it.to} className={`${cls} text-zinc-600`} disabled
                title="Finish previous steps first">
                <Icon d={it.icon} />
                {it.label}
              </button>
            );
          }
          return (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                `${cls} ${isActive ? 'bg-accent text-white' : 'text-zinc-400 hover:text-white hover:bg-neutral-800'}`}
            >
              <Icon d={it.icon} />
              {it.label}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer: component readiness + provider */}
      <div className="p-4 text-xs text-zinc-500 space-y-2 border-t border-edge">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${
            !binStatus ? 'bg-yellow-500 animate-pulse' : ready ? 'bg-emerald-500' : 'bg-red-500'}`} />
          {binStatus === null ? 'Checking components…'
            : ready ? 'FFmpeg + Whisper ready'
              : 'Components missing — open Settings'}
        </div>
        <div>AI: <span className="text-zinc-300 capitalize">{settings.provider}</span></div>
        <div className="text-zinc-600">v1.0 · dark mode</div>
      </div>
    </aside>
  );
}
