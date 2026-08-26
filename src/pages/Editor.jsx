// src/pages/Editor.jsx — global edit settings applied to all enabled clips:
//   jump-cut shifting every ~4.5s · 1.2x speed · frame overlay · channel logo
//   per-clip AI overlay text (headline/subtext/hashtags) · fast low-res previews.
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import { fmtTime } from '../lib/time.js';

const DEFAULT_OPTIONS = {
  speed: 1.2,
  jumpcut: true,
  segLen: 4.5,
  overlayFrame: true,
  logoOn: true,
};

export default function Editor() {
  const { clips, setClips, video, projectId, settings, playRange, toast, navigate } = useApp();

  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState({ headline: '', subtext: '', hashtags: '' });
  const [generating, setGenerating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewPct, setPreviewPct] = useState(0);
  const [previewUrl, setPreviewUrl] = useState(null);

  const enabledClips = clips.filter((c) => c.enabled);
  const selected = useMemo(
    () => clips.find((c) => c.id === selectedId) || enabledClips[0] || null,
    [clips, selectedId]
  );

  // Load selected clip's copy fields into the editor form.
  useEffect(() => {
    if (selected) {
      setDraft({
        headline: selected.headline || '',
        subtext: selected.subtext || '',
        hashtags: (selected.hashtags || []).join(' '),
      });
      setPreviewUrl(null);
    }
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Frame overlay availability depends on the placeholder/user file existing.
  useEffect(() => {
    if (!settings.logoPath && options.logoOn) {
      setOptions((o) => ({ ...o, logoOn: false })); // no logo uploaded yet
    }
  }, [settings.logoPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const persistSelected = async (patch) => {
    const updated = await window.vc.updateClip(selected.id, patch);
    setClips((cs) => cs.map((c) => (c.id === selected.id ? updated : c)));
  };

  const saveTexts = async () => {
    try {
      await persistSelected({
        headline: draft.headline.trim(),
        subtext: draft.subtext.trim(),
        hashtags: draft.hashtags.split(/\s+/).filter(Boolean),
      });
      toast('Overlay text saved.', 'success');
    } catch (e) { toast(String(e.message || e), 'error'); }
  };

  const generateCopy = async () => {
    if (!settings.hasKey) { toast(`Add your ${settings.provider} API key in Settings.`, 'error'); return; }
    setGenerating(true);
    try {
      const updated = await window.vc.generateCopy(selected.id);
      setClips((cs) => cs.map((c) => (c.id === updated.id ? updated : c)));
      setDraft({
        headline: updated.headline || '',
        subtext: updated.subtext || '',
        hashtags: (updated.hashtags || []).join(' '),
      });
      toast('AI copy generated.', 'success');
    } catch (e) { toast(String(e.message || e), 'error'); }
    finally { setGenerating(false); }
  };

  const renderPreview = async () => {
    if (!video || !selected) return;
    setPreviewing(true);
    setPreviewPct(0);
    try {
      const res = await window.vc.renderPreview({
        videoPath: video.path,
        clip: selected,
        options,
        ratio: settings.ratio || '9:16',
      });
      setPreviewUrl(window.vc.toMediaUrl(res.path));
      toast('Preview rendered.', 'success');
    } catch (e) { toast(String(e.message || e), 'error'); }
    finally { setPreviewing(false); }
  };

  if (!enabledClips.length) {
    return (
      <div className="p-12 text-center space-y-3">
        <p className="text-zinc-400">No enabled clips to edit.</p>
        <button className="btn-primary" onClick={() => navigate('/clips')}>Back to Clips</button>
      </div>
    );
  }

  const Toggle = ({ k, label, disabled }) => (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        className="accent-accent w-4 h-4"
        checked={options[k]}
        disabled={disabled}
        onChange={(e) => setOptions((o) => ({ ...o, [k]: e.target.checked }))}
      />
      {label}
    </label>
  );

  return (
    <div className="p-8 max-w-6xl mx-auto pb-24">
      <h1 className="text-2xl font-bold text-white mb-4">Editor</h1>

      {/* ---- Global editing toolbar ---- */}
      <div className="card p-4 flex flex-wrap items-center gap-x-6 gap-y-3 mb-6">
        <span className="label !mb-0">Applied to all {enabledClips.length} enabled clips:</span>
        <Toggle k="jumpcut" label="Jump-cut shift (every 4.5s)" />
        <Toggle k="overlayFrame" label="Phone-frame overlay" />
        <Toggle k="logoOn" label="Channel logo"
          disabled={!settings.logoPath}
          title={settings.logoPath ? '' : 'Upload a logo in Settings first'} />
        <label className="flex items-center gap-2 text-sm">
          Speed
          <select className="input !w-auto py-1" value={options.speed}
            onChange={(e) => setOptions((o) => ({ ...o, speed: Number(e.target.value) }))}>
            <option value="1">1.0x</option>
            <option value="1.1">1.1x</option>
            <option value="1.2">1.2x</option>
            <option value="1.3">1.3x</option>
          </select>
        </label>
        <span className="chip ml-auto">{settings.ratio} · {settings.quality}p (set on Export)</span>
      </div>

      <div className="grid grid-cols-[280px_1fr] gap-6 items-start">
        {/* ---- Clip list ---- */}
        <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
          {enabledClips.map((c) => (
            <button key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`w-full text-left card p-3 transition-colors ${
                selected?.id === c.id ? 'border-accent bg-accent/10' : 'hover:border-zinc-600'}`}>
              <div className="flex justify-between items-center gap-2">
                <span className="text-sm font-medium text-zinc-200 truncate">{c.title}</span>
                <span className="chip shrink-0">{fmtTime(c.end - c.start)}</span>
              </div>
              <div className="text-[11px] text-zinc-500 mt-1 font-mono">
                {fmtTime(c.start)} → {fmtTime(c.end)}
              </div>
            </button>
          ))}
        </div>

        {/* ---- Detail panel ---- */}
        {selected && (
          <div className="space-y-6">
            {/* AI text generation */}
            <section className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-200">Overlay text (AI)</h2>
                <button className="btn-primary px-3 py-1.5 text-xs" onClick={generateCopy} disabled={generating}>
                  {generating ? 'Generating…' : selected.headline ? '↻ Regenerate' : '✨ Generate'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 md:col-span-1">
                  <label className="label">Headline (top 20%)</label>
                  <input className="input uppercase" value={draft.headline}
                    onChange={(e) => setDraft((d) => ({ ...d, headline: e.target.value }))} />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="label">Subtext</label>
                  <input className="input" value={draft.subtext}
                    onChange={(e) => setDraft((d) => ({ ...d, subtext: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="label">Hashtags (space separated)</label>
                  <input className="input" value={draft.hashtags} placeholder="#fyp #viral"
                    onChange={(e) => setDraft((d) => ({ ...d, hashtags: e.target.value }))} />
                </div>
              </div>
              <button className="btn-ghost text-xs" onClick={saveTexts}>Save text</button>
            </section>

            {/* Side-by-side preview */}
            <section className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-200">Preview — original vs edited</h2>
                <div className="flex items-center gap-3">
                  {previewing && <ProgressBar small value={previewPct} />}
                  <button className="btn-primary px-3 py-1.5 text-xs" onClick={renderPreview} disabled={previewing}>
                    {previewing ? 'Rendering…' : 'Render fast preview'}
                  </button>
                  <button className="btn-ghost px-3 py-1.5 text-xs"
                    onClick={() => playRange(selected.start, selected.end)}>
                    ▶ Original segment
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="label">Original clip</p>
                  <div className="aspect-[9/16] max-h-[46vh] mx-auto rounded-lg overflow-hidden bg-black">
                    <video
                      src={`${window.vc.toMediaUrl(video.path)}#t=${selected.start},${selected.end}`}
                      controls preload="metadata"
                      className="w-full h-full object-contain"
                      onLoadedMetadata={(e) => { e.target.currentTime = selected.start; }}
                    />
                  </div>
                </div>
                <div>
                  <p className="label">Edited (low-res check render)</p>
                  <div className="aspect-[9/16] max-h-[46vh] mx-auto rounded-lg overflow-hidden bg-neutral-900 grid place-items-center relative">
                    {previewing && <ProgressBar indeterminate />}
                    {previewUrl ? (
                      <video src={previewUrl} controls autoPlay muted className="w-full h-full object-contain" />
                    ) : (
                      !previewing && <p className="text-xs text-zinc-600 px-6 text-center">
                        Render a fast preview to check jump-cuts, speed, frame, logo and text.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <div className="flex justify-end">
              <button className="btn-primary px-8 py-3"
                onClick={() => navigate('/export')}>
                Continue to Export →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
