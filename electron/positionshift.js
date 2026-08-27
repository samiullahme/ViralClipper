// electron/positionshift.js — "Position Shift Effect" (copyright-bypass drift).
//
// Applies a smooth, eased horizontal slide to an already-rendered clip WITHOUT
// changing its resolution:
//
//   - The clip is placed on a mirrored (hflip) copy of itself as the underlay,
//     so the edges revealed while sliding show a smooth mirror, never a black
//     gap or empty space.
//   - The real clip is overlaid on top, shifted by an eased X(t) that drifts
//     center -> right -> center -> left -> center (random order).
//   - Each position is held 4-6 s (randomized), transitions ease over 0.3-0.5 s.
//   - Shift amount varies per side from {8%,10%,12%} of the frame width.
//
// Everything is computed in Node (random schedule) and lowered into a single
// FFmpeg filter_complex using per-frame overlay x evaluation (eval=frame), so
// the motion is genuinely smooth — no zoompan, no quality loss (crf 18).
const fs = require('fs');
const { spawn } = require('child_process');

const SHIFTS = [0.08, 0.10, 0.12]; // fraction of width, per side
const HOLD_MIN = 4;
const HOLD_MAX = 6;
const TRANS_MIN = 0.3;
const TRANS_MAX = 0.5;

/** Proportional anchored RNG so previews/export can be made reproducible. */
function mulberry(h) {
  return function () {
    h |= 0; h = (h + 0x6D2B79F5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a randomized drift schedule.
 * Returns { transitions: [ {t0,dur,stepFrac} ] }.
 *   t0        start time of the eased transition
 *   dur       transition duration (seconds)
 *   stepFrac  signed change in horizontal offset as a fraction of width
 */
function generateSchedule(duration, seed) {
  const rnd = (typeof seed === 'number' ? mulberry(seed) : Math.random);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const range = (lo, hi) => lo + rnd() * (hi - lo);

  const shiftOf = (pos) =>
    pos === 'center' ? 0 : pos === 'right' ? pick(SHIFTS) : -pick(SHIFTS);

  let pos = 'center';
  let prevFrac = 0;
  let t = 0;
  const transitions = [];

  // If the clip is long enough for more than one transition, walk it.
  if (duration > 1.5) {
    // cap holds so the whole clip gets ~ one drift segment per 4-6 s
    while (t < duration - (HOLD_MIN + TRANS_MAX)) {
      // always pick a target different from the current position so every
      // transition is a real, visible drift (never a no-op step==0).
      const others = (['right', 'left', 'center']).filter((p) => p !== pos);
      const next = pick(others);
      const hold = range(HOLD_MIN, HOLD_MAX);
      const trans = range(TRANS_MIN, TRANS_MAX);
      const transStart = t + hold; // eased transition right after each hold
      const stepFrac = shiftOf(next) - prevFrac;
      transitions.push({ t0: transStart, dur: trans, stepFrac });
      prevFrac += stepFrac;
      pos = next;
      t = transStart + trans;
    }
  }

  // Ultra-short clips: still avoid being static — one slow, gentle horizontal
  // glide from a slight left offset to a slight right offset over the whole span.
  if (transitions.length === 0) {
    transitions.push({ t0: 0, dur: Math.max(0.6, duration * 0.6), stepFrac: 0.18 });
  }

  return { transitions };
}

/** Build the FFmpeg args array that applies the drift to `input` -> `output`. */
function buildShiftArgs({ input, output, W, H, duration, seed }) {
  const { transitions } = generateSchedule(duration, seed);

  // overlay_w = width of the moving overlay = W. Express x as fractional shifts
  // scaled by overlay_w, then nest smoothstep ramps so the path is continuous:
  //   x(t) = overlay_w * ( SUM_k stepFrac_k * smoothstep((t-t0_k)/dur_k) )
  const terms = transitions.map((tr) => {
    const u = `((t-${tr.t0.toFixed(3)})/${tr.dur.toFixed(3)})`;
    const s = `(${u}*${u}*(3-2*${u}))`; // smoothstep
    return `${tr.stepFrac.toFixed(4)}*if(lt(${u},0),0,if(lt(${u},1),${s},1))`;
  });
  const xExpr = `${terms.join('+')}`;

  // Underlay: mirrored full frame. Overlay: the real clip shifted by x(t).
  const filterComplex =
    `[0:v]split[midr][under];` +
    `[under]hflip[mir];` +
    `[mir][midr]overlay=x='(${xExpr})*overlay_w':y=0:eval=frame` +
    // overlay output can exceed W by |maxShift|; recentre & crop back to WxH.
    `[drift];` +
    `[drift]crop=${W}:${H}:(iw-${W})/2:0,format=yuv420p[vout]`;

  const args = [
    '-hide_banner', '-nostats',
    '-i', input,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '0:a?',
    '-preset', 'fast', '-crf', '18', // high quality, matches "no quality loss"
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    '-threads', '2',
    '-progress', 'pipe:1',
    '-y', output,
  ];
  return { args, transitions };
}

/** Probe a media file -> { w, h, duration } via ffmpeg -i (no ffprobe bundled). */
function probe(input, ffmpegPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath || 'ffmpeg', ['-hide_banner', '-i', input], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', () => {
      const durM = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(err);
      const stream = /Stream #0:\d.*Video:.*?(\d{2,5})x(\d{2,5})/.exec(err);
      if (!durM || !stream) return reject(new Error('Could not probe video: ' + err.slice(-200)));
      const duration = (+durM[1]) * 3600 + (+durM[2]) * 60 + parseFloat(durM[3]);
      resolve({ w: +stream[1], h: +stream[2], duration });
    });
    child.on('error', reject);
  });
}

module.exports = { generateSchedule, buildShiftArgs, probe, SHIFTS };
