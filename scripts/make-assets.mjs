// scripts/make-assets.mjs — generates placeholder resources:
//   resources/frame_overlay.png  (1080x1920 phone-frame border, transparent center)
//   resources/app.ico            (256px icon wrapped in an ICO container)
// Replace both files with your own art any time.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const resDir = path.join(root, 'resources');
fs.mkdirSync(resDir, { recursive: true });

// ---- minimal PNG encoder (RGBA, no filtering) --------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- frame_overlay.png: purple phone-mockup border, transparent middle ------
{
  const W = 1080, H = 1920, T = 26; // thickness
  const buf = Buffer.alloc(W * H * 4);
  const set = (x, y, r, g, b, a) => {
    const i = (y * W + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inOuter = x < W && y < H;
      const inInner = x >= T && x < W - T && y >= T && y < H - T;
      if (inOuter && !inInner) {
        // subtle vertical gradient on the frame band
        const t = y / H;
        set(x, y, Math.round(124 - 40 * t), Math.round(58 + 10 * t), Math.round(237 - 30 * t), 255);
      } else {
        set(x, y, 0, 0, 0, 0); // fully transparent center
      }
      // thin inner white keyline
      if (
        (x === T || x === W - T - 1 || y === T || y === H - T - 1) &&
        x >= T && x < W - T && y >= T && y < H - T
      ) set(x, y, 255, 255, 255, 200);
    }
  }
  fs.writeFileSync(path.join(resDir, 'frame_overlay.png'), encodePng(W, H, buf));
}

// ---- app.ico: ICO container wrapping a 256px PNG ------------------------------
{
  const S = 256;
  const buf = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const d = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
      const inside = d <= 0.92;
      // rounded-square gradient: deep purple -> violet
      const r = Math.round(124 - 60 * d), g = Math.round(58 + 20 * d), b = Math.round(237 - 40 * d);
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = inside ? 255 : 0;
      // play-triangle cutout
      const tx = x - S * 0.42, ty = y - S * 0.34;
      if (inside && tx > 0 && tx < S * 0.28 && ty > 0 && ty < tx * 1.15 && ty < S * 0.32 - tx * 0.15) {
        buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; buf[i + 3] = 235;
      }
    }
  }
  const png = encodePng(S, S, buf);
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6);              // 0 => 256px
  header.writeUInt8(0, 7);              // 0 => 256px
  header.writeUInt8(0, 8); header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);          // planes
  header.writeUInt16LE(32, 12);         // bpp
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);         // data offset
  fs.writeFileSync(path.join(resDir, 'app.ico'), Buffer.concat([header, png]));
}

console.log('Assets written to', resDir);
