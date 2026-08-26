// src/components/Settings.jsx — Settings page (also routed at /settings).
// AI provider + key, models, whisper size, channel identity, component installer.
import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import ProgressBar from './ProgressBar.jsx';

const PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat' },
  { id: 'kimi', label: 'Kimi', model: 'moonshot-v1-8k' },
  { id: 'openai', label: 'OpenAI', model: 'gpt-4o-mini' },
];

export default function Settings() {
  const { settings, refreshSettings, toast } = useApp();
  const [provider, setProvider] = useState(settings.provider);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [whisperModel, setWhisperModel] = useState('tiny');
  const [channelName, setChannelName] = useState('');
  const [saving, setSaving] = useState(false);

  // Component download state
  const [bins, setBins] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    setProvider(settings.provider);
    setModel(settings.model || '');
    setWhisperModel(settings.whisperModel || 'tiny');
    setChannelName(settings.channelName || '');
  }, [settings]);

  useEffect(() => {
    window.vc.checkBinaries().then(setBins).catch(() => {});
    const off = window.vc.on('binaries:progress', (s) => {
      setProgress(s);
      if (s.done) {
        setInstalling(false);
        toast('Components installed. You are ready to go!', 'success');
        window.vc.checkBinaries().then(setBins);
      }
      if (s.error) {
        setInstalling(false);
        toast(`Install failed: ${s.error}`, 'error');
      }
    });
    return off;
  }, [toast]);

  const save = async () => {
    setSaving(true);
    try {
      const pairs = { provider };
      if (apiKey.trim()) pairs.api_key = apiKey.trim();   // encrypted in SQLite, never returned
      if (model.trim()) pairs.model = model.trim(); else pairs.model = '';
      pairs.whisper_model = whisperModel;
      pairs.channel_name = channelName.trim();
      await window.vc.setSettings(pairs);
      await refreshSettings();
      setApiKey('');
      toast('Settings saved.', 'success');
    } catch (e) {
      toast(String(e.message || e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const install = async () => {
    setInstalling(true);
    setProgress({ label: 'Starting…', percent: 0 });
    try { await window.vc.installBinaries(); }
    catch (e) {
      setInstalling(false);
      toast(String(e.message || e), 'error');
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6 pb-20">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      {/* ---- AI provider ---------------------------------------------------- */}
      <section className="card p-6 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-200">AI Provider</h2>
        <div className="flex gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => { setProvider(p.id); setModel(''); }}
              className={`btn px-4 py-2 ${provider === p.id ? 'bg-accent text-white' : 'bg-neutral-800 text-zinc-300 hover:bg-neutral-700'}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div>
          <label className="label">API Key</label>
          <input
            type="password"
            className="input"
            placeholder={settings.hasKey ? '•••••••••••• saved (type to replace)' : 'Paste your API key'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-zinc-500">
            Stored encrypted (DPAPI) in the local database — it is never shown again.
          </p>
        </div>

        <div>
          <label className="label">Model override (optional)</label>
          <input className="input" value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={PROVIDERS.find((p) => p.id === provider)?.model} />
        </div>
      </section>

      {/* ---- Whisper ---------------------------------------------------------- */}
      <section className="card p-6 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-200">Whisper model</h2>
        <div className="flex gap-2">
          {['tiny', 'base'].map((m) => (
            <button key={m} onClick={() => setWhisperModel(m)}
              className={`btn px-4 py-2 capitalize ${whisperModel === m ? 'bg-accent text-white' : 'bg-neutral-800 text-zinc-300 hover:bg-neutral-700'}`}>
              {m}
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-500">
          tiny is default and recommended for 2GB RAM machines; base is slower but more accurate.
        </p>
      </section>

      {/* ---- Channel ------------------------------------------------------------ */}
      <section className="card p-6 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-200">Channel</h2>
        <div>
          <label className="label">Channel name (used in export filenames)</label>
          <input className="input" value={channelName} placeholder="my-channel"
            onChange={(e) => setChannelName(e.target.value)} />
        </div>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-lg bg-neutral-900 border border-edge grid place-items-center overflow-hidden">
            {settings.logoPath
              ? <img src={window.vc.toMediaUrl(settings.logoPath)} alt="logo" className="w-full h-full object-contain" />
              : <span className="text-xs text-zinc-600">none</span>}
          </div>
          <div className="space-y-2">
            <button className="btn-ghost"
              onClick={async () => {
                const p = await window.vc.pickLogo();
                if (p) { await refreshSettings(); toast('Logo saved.', 'success'); }
              }}>
              Upload logo PNG
            </button>
            <p className="text-xs text-zinc-500">
              Rendered bottom-right at 10% width, 85% opacity on every export.
            </p>
          </div>
        </div>
      </section>

      {/* ---- Components ----------------------------------------------------------- */}
      <section className="card p-6 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-200">Components</h2>
        {bins && (
          <div className="flex gap-6 text-sm">
            <span>FFmpeg: {bins.ffmpeg
              ? <b className="text-emerald-400">ready</b>
              : <b className="text-red-400">missing</b>}</span>
            <span>Python/Whisper: {bins.python
              ? <b className="text-emerald-400">ready</b>
              : <b className="text-red-400">missing</b>}</span>
          </div>
        )}
        {!bins?.ffmpeg || !bins?.python ? (
          <>
            <button className="btn-primary" onClick={install} disabled={installing}>
              {installing ? 'Installing…' : 'Download missing components'}
            </button>
            {installing && progress && (
              <ProgressBar value={progress.percent || 0}
                indeterminate={!progress.total}
                label={progress.label || progress.step} />
            )}
            <p className="text-xs text-zinc-500">
              Downloads FFmpeg (static build) and embedded Python 3.10 + faster-whisper.
              One-time, needs internet.
            </p>
          </>
        ) : (
          <p className="text-xs text-emerald-400">All components installed.</p>
        )}
      </section>

      {/* ---- Theme note -------------------------------------------------------------- */}
      <section className="card p-6 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">Theme</h2>
          <p className="text-xs text-zinc-500 mt-1">Dark mode only — easy on the eyes during long edit sessions.</p>
        </div>
        <span className="chip bg-accent/20 text-accent-soft">Dark · locked</span>
      </section>

      <div className="sticky bottom-0 py-4 bg-gradient-to-t from-ink via-ink to-transparent">
        <button className="btn-primary w-40" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}
