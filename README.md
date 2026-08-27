# ViralClipper

Turn long videos into viral short clips for YouTube Shorts, TikTok, and Instagram Reels — fully offline except for the AI calls you choose to make.

**Stack:** Electron · React · Tailwind CSS · embedded Python (faster-whisper) · FFmpeg (static binary) · SQLite

---

## How it works

```
Load video → Transcribe locally (whisper tiny/base) → AI finds viral moments
→ Edit (jump-cut shift + 1.2x speed + phone frame + logo + AI overlay text)
→ Export 9:16 / 1:1 / 16:9 / 4:5 at 720p/1080p
```

### The editing trick
Every ~4.5 s the clip is cropped and shifted **LEFT → RIGHT → CENTER** in a loop
(one time-based `crop` expression — cheap on CPU), sped up to **1.2x**
(`setpts=0.833*PTS` + `atempo=1.2`), framed by `resources/frame_overlay.png`,
stamped with your channel logo (bottom-right, 10 % width, 85 % opacity), and
topped with bold white/black-stroked AI text via `drawtext`.

### Position-shift effect (copyright bypass)
On export, each finished clip runs through an optional **post-trim pass**
(`electron/positionshift.js`) that adds a smooth horizontal drift — useful to
re-encode and shift the output so it differs from stock/system sources:

- The clip is placed over its own **mirrored (hflip) copy**, so the edges revealed
  while sliding show a smooth mirror, never a black gap.
- A Node-generated **random schedule** drifts `center → right → center → left →
  center`, holding each position **4–6 s** (randomized) and easing between them
  over **0.3–0.5 s** via per-frame `overlay` x-eval.
- Shift amount varies per side from **8 / 10 / 12 %** of the frame width.
- Output stays **the same resolution** as the input; re-encoded with `libx264 crf
  18` for no visible quality loss. Toggle on the **Editor** toolbar ("Position-shift
  drift"), persisted in settings and applied before the final file is written.

---

## Project layout

```
ViralClipper/
├── electron/            # main process: window, IPC, ffmpeg/python bridges
│   ├── main.js          # app entry, vc:// media protocol, protocol security
│   ├── preload.js       # contextBridge -> window.vc API (no Node in renderer)
│   ├── ipcHandlers.js   # dialogs/projects/settings/transcribe/AI/export
│   ├── db.js            # SQLite layer (projects, clips, settings)
│   ├── ai.js            # DeepSeek / Kimi / OpenAI client
│   ├── ffmpeg.js        # filter-graph builder (crop shift, overlays, text)
│   ├── binaries.js      # auto-download ffmpeg.exe & embedded python
│   └── paths.js         # portable folder path resolution
├── src/                 # React renderer (dark theme, lazy pages)
│   ├── pages/           # Home, Transcribe, Clips, Editor, Export
│   └── components/      # Sidebar, VideoPlayer, ClipCard, ProgressBar, Settings
├── python/
│   └── transcribe.py    # whisper worker, JSON-lines IPC on stdout
├── resources/
│   ├── frame_overlay.png  # ← REPLACE with your phone-mockup PNG (1080x1920, transparent center)
│   └── app.ico
├── scripts/             # asset generator, portable zip, native rebuild
└── db/database.sqlite   # created at runtime next to app.exe
```

## Development

Prerequisites: **Node 18+**, and on Windows **VS Build Tools (C++ workload)** for
the `better-sqlite3` native module.

```bash
npm install          # auto-rebuilds sqlite for Electron's ABI (best effort)
npm run assets       # regenerate placeholder overlay/icon (optional)
npm run dev          # vite dev server + electron with hot reload
```

## Build the portable app (Windows)

```bash
npm run dist:portable
# → release/win-unpacked/          (extractable folder: app.exe + binaries)
# → release/ViralClipper-portable.zip
```

The zip contains everything as a flat folder:

```
ViralClipper-portable/
├── app.exe          ← just run it, no installer, no admin rights
├── ffmpeg.exe       ← downloaded automatically on first run if missing
├── python/          ← embedded Python 3.10 + faster-whisper (auto-installed)
├── resources/
└── db/
```

First launch downloads FFmpeg (~80 MB) and Python+faster-whisper (~150 MB) once,
with live progress under **Settings → Components**. Everything else is offline.

## Settings

| Setting | Values |
|---|---|
| AI provider | DeepSeek (`deepseek-chat`) · Kimi (`moonshot-v1-8k`) · OpenAI (`gpt-4o-mini`) |
| API key | Stored DPAPI-encrypted in SQLite, never displayed again |
| Whisper model | `tiny` (default, 2 GB RAM friendly) · `base` |
| Channel logo | PNG, rendered bottom-right on exports |
| Channel name | Used in `{channel}_{clip_title}_{date}.mp4` filenames |

## Performance notes

- FFmpeg runs as a streamed child process (`-progress pipe:1`), `-threads 2`, `-preset fast` — video is never loaded into memory.
- Whisper uses CPU int8, batch size 1, streaming segment-by-segment progress.
- Renderer code-splits per page; no heavy UI libraries beyond Tailwind.
- SQLite (WAL mode) stores projects, transcripts, clips and settings.
