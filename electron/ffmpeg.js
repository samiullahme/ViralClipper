// electron/ffmpeg.js — builds ffmpeg argument lists for every render mode.
//
// Editing trick implemented here:
//   - Jump cuts every ~4.5s with LEFT / RIGHT / CENTER crop shifting (looped),
//     done as a single time-based crop expression (cheap, no segment concat).
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
 * Time-based jump-cut crop expression.
 * Segment length segLen; pattern loops LEFT, RIGHT, CENTER.
 * Crop width keeps shiftPct total room; x slides within it.
 * NOTE: inside crop x/y expressions use iw/ow (not w).
 */
function jumpCutXExpr(segLen) {
  // n = floor(t/seg); r = n - 3*floor(n/3)  (mod-3 without mod(), max compat)
  const n = `floor(t/${segLen})`;
  const r = `(${n}-3*floor(${n}/3))`;
  return `'if(lt(${r},1),(iw-ow),if(lt(${r},2),0,(iw-ow)/2))'`;
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

  // 1) Jump-cut crop (uses ORIGINAL timeline t, so apply before setpts).
  const baseFilters = [];
  if (opts.jumpcut) {
    baseFilters.push(
      `crop=w='trunc(iw*${(1 - 0.05).toFixed(2)})':h=ih:x=${jumpCutXExpr(opts.segLen || 4.5)}:y=0`
    );
  }

  // 2) Speed up video (1.2x -> 0.833*PTS).
  const speed = Math.min(Math.max(opts.speed || 1.2, 1), 2);
  if (speed !== 1) baseFilters.push(`setpts=${(1 / speed).toFixed(3)}*PTS`);

  // 3) Normalize fps + fit to target canvas.
  baseFilters.push('fps=30');
  baseFilters.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`);
  baseFilters.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`);
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
    '-map', '[vout]',
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
