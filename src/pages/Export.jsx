// src/pages/Export.jsx — ratio/quality selection, output folder, queued exports
// with per-clip progress, and "open folder" when finished.
import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import { fmtHms } from '../lib/time.js';

const RATIOS = [
  { id: '9:16', label: '9:16 Shorts' },
  { id: '1:1', label: '1:1 Square' },
  { id: '16:9', label: '16:9 Landscape' },
  { id: '4:5', label: '4:5 Portrait' },
];

export default function Export() {
  const { clips, video, projectId, settings, refreshSettings, toast, navigate } = useApp();

  const [ratio, setRatio] = useState(settings.ratio || '9:16');
  const [quality, setQuality] = useState(settings.quality || '1080');
  const [outDir, setOutDir] = useState(settings.outputDir || '');
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState({});        // clipIndex -> {percent,status}
  const [doneOutputs, setDoneOutputs] = useState([]);
  const [currentTitle, setCurrentTitle] = useState('');

  const enabledClips = clips.filter((c) => c.enabled);
  void projectId; // clips already carry persisted edits

  // Live progress from the export queue in the main process.
  useEffect(() => {
    const offs = [
      window.vc.on('export:progress', ({ index, percent, title }) => {
        setCurrentTitle(title);
        setRows((r) => ({ ...r, [index]: { percent, status: 'rendering' } }));
      }),
      window.vc.on('export:item-done', ({ index }) => {
        setRows((r) => ({ ...r, [index]: { percent: 100, status: 'done' } }));
      }),
      window.vc.on('export:error', ({ index, message }) => {
        setRows((r) => ({ ...r, [index]: { percent: 0, status: 'error', message } }));
      }),
      window.vc.on('export:done', ({ outputs }) => {
        setRunning(false);
        setDoneOutputs(outputs);
        toast(`Export finished — ${outputs.length} file(s).`, 'success');
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [toast]);

  const pickFolder = async () => {
    const p = await window.vc.pickFolder();
    if (p) {
      setOutDir(p);
      await window.vc.setSettings({ output_dir: p });
      refreshSettings();
    }
  };

  const startExport = async () => {
    if (!enabledClips.length) { toast('No clips are enabled.', 'error'); return; }
    if (!outDir) { toast('Choose an output folder first.', 'error'); return; }
    setRunning(true);
    setDoneOutputs([]);
    setRows(Object.fromEntries(enabledClips.map((_, i) => [i, { percent: 0, status: 'queued' }])));
    try {
      await window.vc.runExport({
        videoPath: video.path,
        clips: enabledClips,
        options: {
          speed: 1.2, jumpcut: true, segLen: 4.5,
          overlayFrame: true, logoOn: !!settings.logoPath,
        },
        ratio,
        quality,
        outDir,
        channel: settings.channelName || 'channel',
      });
    } catch (e) {
      setRunning(false);
      toast(String(e.message || e), 'error');
    }
  };

  if (!enabledClips.length) {
    return (
      <div className="p-12 text-center space-y-3">
        <p className="text-zinc-400">Nothing to export yet.</p>
        <button className="btn-primary" onClick={() => navigate('/clips')}>Back to Clips</button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto pb-24">
      <h1 className="text-2xl font-bold text-white mb-6">Export</h1>

      {/* ---- Output format ---- */}
      <section className="card p-6 space-y-5">
        <div>
          <label className="label">Output ratio</label>
          <div className="flex flex-wrap gap-2">
            {RATIOS.map((r) => (
              <button key={r.id}
                onClick={() => { setRatio(r.id); window.vc.setSettings({ ratio: r.id }); }}
                className={`btn px-4 py-2 ${ratio === r.id ? 'bg-accent text-white' : 'bg-neutral-800 text-zinc-300 hover:bg-neutral-700'}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Quality</label>
            <select className="input" value={quality}
              onChange={(e) => { setQuality(e.target.value); window.vc.setSettings({ quality: e.target.value }); }}>
              <option value="720">720p (faster)</option>
              <option value="1080">1080p (recommended)</option>
            </select>
          </div>
          <div>
            <label className="label">Output folder</label>
            <div className="flex gap-2">
              <input className="input" readOnly value={outDir} placeholder="Not chosen" />
              <button className="btn-ghost shrink-0" onClick={pickFolder}>Browse…</button>
            </div>
          </div>
        </div>

        <p className="text-xs text-zinc-500">
          Filenames: <span className="text-zinc-400 font-mono">
            {`${settings.channelName || 'channel'}_${(enabledClips[0]?.title || 'clip_title')
              .replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.mp4`}
          </span>{' '}
          ({enabledClips.length} clips · {fmtHms(enabledClips.reduce((a, c) => a + (c.end - c.start), 0))} total)
        </p>

        <div className="flex items-center gap-3">
          <button className="btn-primary px-8 py-3" onClick={startExport} disabled={running}>
            {running ? 'Exporting…' : `🚀 Export ${enabledClips.length} clip${enabledClips.length > 1 ? 's' : ''}`}
          </button>
          {running && (
            <button className="btn-danger" onClick={() => window.vc.cancelExport()}>Cancel</button>
          )}
          {doneOutputs.length > 0 && !running && (
            <button className="btn-ghost"
              onClick={() => window.vc.openPath(outDir)}>
              📂 Open output folder
            </button>
          )}
        </div>
      </section>

      {/* ---- Queue ---- */}
      <section className="mt-6 space-y-3">
        {enabledClips.map((c, i) => {
          const row = rows[i];
          return (
            <div key={c.id} className="card p-4">
              <ProgressBar
                small
                value={row?.percent ?? 0}
                label={`${String(i + 1).padStart(2, '0')} · ${c.title}`}
              />
              <div className="mt-1.5 text-[11px]">
                {row?.status === 'done' && <span className="text-emerald-400">✓ done</span>}
                {row?.status === 'error' && <span className="text-red-400">failed: {row.message}</span>}
                {row?.status === 'rendering' && running && (
                  <span className="text-accent-soft">rendering{row.percent ? '' : ` — ${currentTitle}`}</span>
                )}
                {!row && <span className="text-zinc-600">queued ({fmtHms(c.end - c.start)})</span>}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
