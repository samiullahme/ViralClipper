// electron/ffmpeg.js — builds ffmpeg argument lists for every render mode.
//
// Editing trick implemented here:
//   - Smooth sinusoidal pan: the crop window moves continuously across the
//     video (±10–44 px at 1080p), so the output always FEELS like real
//     motion — never static, never a freeze-frame.
//   - Every ~4.5 s the base position resets (LEFT → RIGHT → CENTER loop)
//     via a step offset layered on top of the smooth oscillation.
//   - Speed 1.2x via setpts=0.833*PTS + atempo.
//   - frame_overlay.png scaled over the video, channel logo bottom-right @85%.
//   - drawtext overlays (headline / subtext / hashtags) using textfile= so we
//     never have to escape user text into the filtergraph.
const fs = require('fs');
const os = require('os');
const path = require('path');

const RATIOS = {
  '9:16':  { w: 1080, h: 1920 },
  '1:1':   { w: 1080, h: 1080 },
  '16:9':  { w: 1920, h: 1080 },
  '4:5':   { w: 1080, h: 1350 },
};

/** Resolve output WxH from ratio + quality (720p/1080p short side). */
function outputDims(ratio, quality) {
  const base = RATIOS[ratio] || RATIOS['9:16'];
  const q = quality === 720 ? 720 : 1080;
  const short = Math.min(base.w, base.h);
  const longSide = Math.round((Math.max(base.w, base.h) * q) / short / 2) * 2;
  return base.w < base.h ? { w: q, h: longSide } : { w: longSide, h: q };
}

/** Preview dims: same aspect, tiny (fast low-res check render). */
function previewDims(ratio) {
  const base = RATIOS[ratio] || RATIOS['9:16'];
  const q = 480;
  const short = Math.min(base.w, base.h);
  const longSide = Math.round((Math.max(base.w, base.h) * q) / short / 2) * 2;
  return base.w < base.h ? { w: q, h: longSide } : { w: longSide, h: q };
}

/** Quote/escape a path used INSIDE a filtergraph option value. */
function q(p) {
  return "'" + String(p).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'") + "'";
}

/** Find a bold system font for drawtext (platform-dependent). */
function findBoldFont() {
  const candidates = process.platform === 'win32'
    ? ['C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/impact.ttf']
    : process.platform === 'darwin'
      ? ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc']
      : ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'];
  return candidates.find((f) => fs.existsSync(f)) || null;
}

/**
 * Cropped width as a fraction of the full input width. This is the "panning
 * room" — how far the crop window can slide across the video. Larger room =
 * more noticeable movement without losing content to black edges.
 * Preview renders use more room (up to 12%) so the motion reads clearly at small size.
 */
function cropWidthPct(quality) {
  return quality === 'preview' ? 0.88 : 0.96; // keep 4% visible crop edge on 1080p export
}

/**
 * Build the time-based crop x expression — SMOOTH + periodic stepping.
 *
 * The crop window slides horizontally within the pan room `(iw-ow)`; every
 * value is a fraction of that room so it scales with any source resolution.
 *
 *   base   = step offset resetting every `segLen`s: LEFT → RIGHT → CENTER loop
 *   sway   = continuous sine panning (never static — the video is always moving)
 *   bounce = spring oscillation right after each step flip, so the direction
 *            change feels organic instead of mechanically abrupt
 *
 * x = clamp(base + sway + bounce, 0, iw-ow)
 *
 * NOTE: inside crop x/y expressions use iw/ow (not w).
 */
function panXExpr(segLen, quality) {
  const room = cropWidthPct(quality);            // 0.96 export / 0.88 preview
  const R = `(iw-ow)`;                           // full pan room (positive)
  const seg = segLen || 4.5;

  // n = floor(t/seg); r = n - 3*floor(n/3)  (mod-3 without mod(), max compat)
  const nf = `floor(t/${seg})`;
  const r = `(${nf}-3*floor(${nf}/3))`;
  const ph = `(t-${seg}*${nf})/${seg}`;          // 0..1 within the current segment

  // Left / right / center as fractions of the pan room.
  const base = `if(lt(${r},1),0,if(lt(${r},2),1,0.5))*${R}`;

  // Continuous sinusoidal pan — ~1.5 oscillations per segment (clearly moving).
  const sway = `0.30*${R}*sin(3*PI*t/${seg})`;

  // Spring-in/out right after each step boundary for a natural "reposition".
  const bounce = `0.12*${R}*sin(${seg}*PI*${ph})*exp(-3.5*${ph})`;

  return `'clip(${base}+${sway}+${bounce},0,${R})'`;
}

/**
 * Rounded-corner "rounded box" luma expression for geq.
 * A point is inside the rounded rectangle if its distance to the inner box is
 * <= R. Implemented via the signed-distance trick: px=clip(X,R,W-R),
 * py=clip(Y,R,H-R); inside when (X-px)^2+(Y-py)^2 <= R^2.
 */
function roundedBoxLuma(W, H, R) {
  const R2 = R * R;
  return `if(lte(pow(X-clip(X,${R},${W - R}),2)+pow(Y-clip(Y,${R},${H - R}),2),${R2}),255,0)`;
}

// Cache of generated phone-frame PNGs keyed by "<W>x<H>".
const pfCache = new Map();

/**
 * Build (and cache) a single rounded white phone-frame PNG for a WxH screen.
 * The PNG is OWxOH with the WHITE ROUNDED BODY RING drawn as solid alpha and
 * EVERYTHING ELSE transparent (screen area + outer area). Layering a video
 * behind it + a light backdrop makes the classic "mockup" look.
 *
 * Rendering once per resolution (single frame, via spawnSync) is cheap; the
 * per-frame cost in the video filtergraph is then just two overlays.
 */
function phoneFramePng(W, H, ffmpegPath, dir) {
  const key = `${W}x${H}`;
  if (pfCache.has(key)) return pfCache.get(key);
  const short = Math.min(W, H);
  const BEZEL = Math.max(2, Math.round(short * 0.018));
  const MARGIN = Math.max(4, Math.round(short * 0.05));
  const RC = Math.max(4, Math.round(short * 0.03));
  const RCB = RC + BEZEL;
  const SW = W + 2 * BEZEL, SH = H + 2 * BEZEL;
  const OW = SW + 2 * MARGIN, OH = SH + 2 * MARGIN;
  // Screen rect within the PNG (its top-left = MARGIN + BEZEL).
  const SX = MARGIN + BEZEL, SY = MARGIN + BEZEL;

  const out = `${dir}/pf_${W}x${H}.png`;
  const fs = require('fs');
  if (!fs.existsSync(out)) {
    // Screen rect within the PNG (top-left = SX,SY). We compute ring membership
    // using coordinates relative to the screen box for its inner-cut.
    const bodyIn = `lte(pow(X-clip(X,${RCB},${SW - RCB}),2)+pow(Y-clip(Y,${RCB},${SH - RCB}),2),${RCB * RCB})`;
    const scrX = `X-${SX}`;
    const scrY = `Y-${SY}`;
    const screenIn = `lte(pow(${scrX}-clip(${scrX},${RC},${W - RC}),2)+pow(${scrY}-clip(${scrY},${RC},${H - RC}),2),${RC * RC})`;
    // alpha = 255 on the body ring (inside body AND NOT inside screen), else 0.
    // (Uses arithmetic instead of and()/not() for ffmpeg-eval compatibility:
    //  bodyIn and screenIn are 0/1, so bodyIn*(1-screenIn) is the AND-NOT.)
    const ring = `if(${bodyIn}*(1-${screenIn}),255,0)`;
    const geqExp = `a='${ring}':r=255:g=255:b=255`;
    // One frame (d=1,r=1): assemble RGB+alpha then write a full-frame PNG.
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=black:s=${OW}x${OH}:d=1:r=1`,
      '-vf', `format=rgba,geq=${geqExp},format=rgba`,
      '-frames:v', '1', '-update', '1', out,
    ];
    const { spawnSync } = require('child_process');
    const res = spawnSync(ffmpegPath || 'ffmpeg', args, { timeout: 20000 });
    if (res.status !== 0 || !fs.existsSync(out)) {
      if (res.status !== 0) console.error(res.stderr && res.stderr.toString());
      throw new Error('Could not build phone-frame PNG.');
    }
  }
  const meta = { png: out, W, H, SW, SH, OW, OH, SX, SY, BEZEL, MARGIN };
  pfCache.set(key, meta);
  return meta;
}

/**
 * Build the phone-mockup frame chain around the already-rendered SCREEN.
 * input label `inLabel` (a WxH, cover-filled video). Adds the phone-frame PNG
 * as an extra input and returns { filters:[...ending in [pfout]], inputs:[...] }.
 * Cheap at runtime (two overlays per frame), no per-frame geq.
 */
function phoneFrameChain(inLabel, W, H, opts) {
  opts = opts || {};
  const meta = phoneFramePng(W, H, opts.ffmpeg || 'ffmpeg', opts.tmpDir || os.tmpdir());
  const BG = opts.frameBg || '0xEEEEEE';
  const idx = opts.inputIndex; // index of the PNG in the -i list
  return {
    inputs: [meta.png],
    filters: [
      `color=c=${BG}:s=${meta.OW}x${meta.OH}:r=30[pf_bg]`,
      `[pf_bg][${inLabel}]overlay=${meta.SX}:${meta.SY}:shortest=1[pf_s1]`,
      `[${idx}:v]loop=loop=-1:size=1[pf_frame]`,
      `[pf_s1][pf_frame]overlay=0:0:shortest=1,format=yuv420p[pfout]`,
    ],
  };
}

/**
 * Build the complete ffmpeg args array.
 *
 * opts = {
 *   input, output, start, end,            // seconds
 *   ratio:'9:16', quality:1080|'preview',
 *   speed:1.2, jumpcut:true, segLen:4.5,
 *   overlayFrame:false, logoPath:null,
 *   texts:{headline,subtext,hashtags[]},  // optional
 * }
 */
function buildArgs(opts) {
  const isPreview = opts.quality === 'preview';
  const { w: W, h: H } = isPreview ? previewDims(opts.ratio) : outputDims(opts.ratio, opts.quality);

  const filters = [];

  // 1) Panning crop (uses ORIGINAL timeline t, so apply before setpts).
  // Continuous sinusoidal movement + periodic LEFT/RIGHT/CENTER re-centering.
  const baseFilters = [];
  if (opts.jumpcut) {
    baseFilters.push(
      `crop=w='trunc(iw*${(cropWidthPct(opts.quality)).toFixed(2)})':h=ih:` +
      `x=${panXExpr(opts.segLen || 4.5, opts.quality)}:y=0`
    );
  }

  // 2) Speed up video (1.2x -> 0.833*PTS).
  const speed = Math.min(Math.max(opts.speed || 1.2, 1), 2);
  if (speed !== 1) baseFilters.push(`setpts=${(1 / speed).toFixed(3)}*PTS`);

  // 3) Normalize fps + fit to target canvas.
  baseFilters.push('fps=30');
  if (opts.phoneFrame) {
    // Phone frame = edge-to-edge fill (cover-crop), NO black bars.
    baseFilters.push(`scale=${W}:${H}:force_original_aspect_ratio=increase`);
    baseFilters.push(`crop=${W}:${H}`);
  } else {
    baseFilters.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`);
    baseFilters.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`);
  }
  baseFilters.push('format=yuv420p');

  // Labeled base chain: [0:v]...[base]
  filters.push(`[0:v]${baseFilters.join(',')}[base]`);
  let label = '[base]';

  // 4) Frame overlay (input #1 when present).
  let inputIdx = 1;
  const inputs = [];
  if (opts.overlayFrame && opts.framePath && fs.existsSync(opts.framePath)) {
    inputs.push('-i', opts.framePath);
    filters.push(`[${inputIdx}:v]scale=${W}:${H}[frm]`);
    filters.push(`${label}[frm]overlay=0:0[b1]`);
    label = '[b1]';
    inputIdx++;
  }

  // 5) Channel logo bottom-right at 10% width, 85% opacity.
  if (opts.logoPath && fs.existsSync(opts.logoPath)) {
    inputs.push('-i', opts.logoPath);
    const lw = Math.round(W * 0.1);
    filters.push(`[${inputIdx}:v]scale=${lw}:-2,format=rgba,colorchannelmixer=aa=0.85[logo]`);
    filters.push(`${label}[logo]overlay=main_w-overlay_w-main_w*0.03:main_h-overlay_h-main_h*0.03[b2]`);
    label = '[b2]';
    inputIdx++;
  }

  // 6) Text overlays via textfile (no escaping problems).
  const fontFile = findBoldFont();
  const fontPart = fontFile ? `fontfile=${q(fontFile)}:` : '';
  const texts = opts.texts || {};
  const textFilters = [];
  const tmpFiles = [];
  const mkText = (content, size, y, borderw) => {
    if (!content) return;
    const f = path.join(os.tmpdir(), `vc_text_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(f, String(content), 'utf8');
    tmpFiles.push(f);
    textFilters.push(
      `drawtext=${fontPart}textfile=${q(f)}:fontsize=${size}:fontcolor=white:` +
      `borderw=${borderw}:bordercolor=black:x=(w-text_w)/2:y=${y}`
    );
  };
  const scaleT = H / 1920; // type scale relative to 1080x1920 design size
  mkText(texts.headline, Math.round(64 * scaleT), `h*0.13`, 4);
  mkText(texts.subtext, Math.round(38 * scaleT), `h*0.13+${Math.round(110 * scaleT)}`, 3);
  mkText(
    Array.isArray(texts.hashtags) ? texts.hashtags.join(' ') : '',
    Math.round(32 * scaleT), 'h*0.84', 2
  );

  if (textFilters.length) {
    filters.push(`${label}${textFilters.join(',')}[vout]`);
  } else {
    filters.push(`${label}null[vout]`);
  }

  // 7) Phone-mockup frame (optional, outermost layer).
  let mapLabel = '[vout]';
  if (opts.phoneFrame) {
    const pfIndex = inputIdx;
    const pf = phoneFrameChain('vout', W, H, { ...opts, inputIndex: pfIndex });
    inputs.push('-i', pf.inputs[0]);
    filters.push(...pf.filters);
    mapLabel = '[pfout]';
    inputIdx++;
  }

  // Audio tempo chain (atempo only accepts 0.5–2.0 per stage).
  const af = speed === 1 ? [] : ['-af', `atempo=${speed}`];

  const args = [
    '-hide_banner', '-nostats',
    // Input-side seek+duration: reads EXACTLY [start,end] of the source.
    // (As an output option, -t would keep reading extra input because the
    // sped-up timeline produces less output than input consumed.)
    '-ss', String(Math.max(0, opts.start)),
    '-t', String(Math.max(0.5, opts.end - opts.start)),
    '-i', opts.input,
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', mapLabel,
    '-map', '0:a?',
    ...af,
    ...(isPreview
      ? ['-preset', 'ultrafast', '-crf', '34']
      : ['-preset', 'fast', '-crf', '23']),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    '-threads', '2',
    '-progress', 'pipe:1',
    '-y', opts.output,
  ];
  return { args, tmpFiles, W, H };
}

module.exports = { buildArgs, outputDims, previewDims, RATIOS };
