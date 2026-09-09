#!/usr/bin/env node
/**
 * Generate the packaging icons (PNG + ICO) with zero external dependencies.
 *
 * The icon is rendered procedurally: a rounded gradient square with the
 * "hub" glyph (one centre node connected to three satellites). Because the
 * raster is produced here, `npm run icons` works on any OS with just Node -
 * no ImageMagick, no native tooling. `build/logo.svg` is the matching vector
 * artwork kept for documentation.
 *
 * Output:
 *   build/icon.png  512x512 (macOS/Linux)
 *   build/tray.png  32x32   (system tray)
 *   build/icon.ico  multi-size ICO with embedded PNGs (Windows)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BUILD = path.join(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// -- Palette / geometry (mirrors build/logo.svg) ------------------------------
const C1 = [0x4f, 0x8c, 0xff];
const C2 = [0x6d, 0x7c, 0xf5];
const C3 = [0xa8, 0x6b, 0xf0];
const CENTER = [0x5b, 0x6c, 0xf0];
const RADIUS = 112; // corner radius in 512 space

const LINES = [
  [256, 256, 146, 168],
  [256, 256, 366, 168],
  [256, 256, 256, 388]
];
const NODES = [
  [146, 168, 34],
  [366, 168, 34],
  [256, 388, 34]
];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;

function roundedBox(x, y, half, r) {
  const dx = Math.abs(x - half) - (half - r);
  const dy = Math.abs(y - half) - (half - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  const outside = Math.sqrt(ax * ax + ay * ay) - r;
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside;
}

function segDist(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : clamp01(((x - x1) * dx + (y - y1) * dy) / length);
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
}

const circle = (x, y, px, py, r) => Math.sqrt((x - px) ** 2 + (y - py) ** 2) - r;

/**
 * Render the icon at `size` (CSS px) with supersampling.
 * @returns {Buffer} RGBA pixel data
 */
function render(size) {
  const SS = size <= 32 ? 3 : 4; // supersampling factor
  const scale = size / 512;
  const lineWidth = 8.5; // in 512 space
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let ra = 0;
      let rg = 0;
      let rb = 0;
      let aa = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          // sample position in 512 space
          const fx = (x + (sx + 0.5) / SS) / scale;
          const fy = (y + (sy + 0.5) / SS) / scale;

          const coverage = clamp01(0.5 - roundedBox(fx, fy, 256, RADIUS));
          if (coverage <= 0) continue;

          // diagonal gradient background
          const t = clamp01((fx + fy) / 1024);
          let [r, g, b] = C2;
          if (t < 0.5) {
            const u = t / 0.5;
            r = lerp(C1[0], C2[0], u);
            g = lerp(C1[1], C2[1], u);
            b = lerp(C1[2], C2[2], u);
          } else {
            const u = (t - 0.5) / 0.5;
            r = lerp(C2[0], C3[0], u);
            g = lerp(C2[1], C3[1], u);
            b = lerp(C2[2], C3[2], u);
          }

          // top gloss
          const gloss = 0.22 * clamp01(1 - fy / 307);
          r = lerp(r, 255, gloss);
          g = lerp(g, 255, gloss);
          b = lerp(b, 255, gloss);

          // hub spokes
          let spoke = Infinity;
          for (const [x1, y1, x2, y2] of LINES) {
            spoke = Math.min(spoke, segDist(fx, fy, x1, y1, x2, y2));
          }
          const stroke = clamp01(lineWidth + 0.5 - spoke) * 0.95;
          r = lerp(r, 255, stroke);
          g = lerp(g, 255, stroke);
          b = lerp(b, 255, stroke);

          // satellite nodes
          for (const [px, py, pr] of NODES) {
            const n = clamp01(0.7 - circle(fx, fy, px, py, pr));
            r = lerp(r, 255, n);
            g = lerp(g, 255, n);
            b = lerp(b, 255, n);
          }

          // centre node + pupil
          const centre = clamp01(0.7 - circle(fx, fy, 256, 256, 52));
          r = lerp(r, 255, centre);
          g = lerp(g, 255, centre);
          b = lerp(b, 255, centre);
          const pupil = clamp01(0.7 - circle(fx, fy, 256, 256, 20)) * 0.9;
          r = lerp(r, CENTER[0], pupil);
          g = lerp(g, CENTER[1], pupil);
          b = lerp(b, CENTER[2], pupil);

          ra += r * coverage;
          rg += g * coverage;
          rb += b * coverage;
          aa += 255 * coverage;
        }
      }

      const n = SS * SS;
      const offset = (y * size + x) * 4;
      out[offset] = Math.round(ra / n);
      out[offset + 1] = Math.round(rg / n);
      out[offset + 2] = Math.round(rb / n);
      out[offset + 3] = Math.round(aa / n);
    }
  }

  return out;
}

// -- PNG encoder --------------------------------------------------------------

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(stride + 1); // filter byte 0 per row
    rgba.copy(row, 1, y * stride, (y + 1) * stride);
    rows.push(row);
  }
  const idat = zlib.deflateSync(Buffer.concat(rows), { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// -- ICO encoder (PNG-in-ICO, supported by Windows Vista and later) -----------

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directorySize = entries.length * 16;
  let offset = 6 + directorySize;

  const directoryParts = [];
  const dataParts = [];

  for (const { size, png } of entries) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    directoryParts.push(entry);
    dataParts.push(png);
    offset += png.length;
  }

  return Buffer.concat([header, ...directoryParts, ...dataParts]);
}

// -- Main ---------------------------------------------------------------------

function main() {
  fs.mkdirSync(BUILD, { recursive: true });

  const pngs = new Map();
  for (const size of SIZES) {
    const started = Date.now();
    const rgba = render(size);
    const png = encodePng(size, rgba);
    pngs.set(size, png);
    console.log(`  rendered ${size}x${size} in ${Date.now() - started}ms`);
  }

  fs.writeFileSync(path.join(BUILD, 'icon.png'), pngs.get(512));
  fs.writeFileSync(path.join(BUILD, 'tray.png'), pngs.get(32));
  fs.writeFileSync(
    path.join(BUILD, 'icon.ico'),
    encodeIco(ICO_SIZES.map((size) => ({ size, png: pngs.get(size) })))
  );

  console.log('Wrote build/icon.png, build/tray.png and build/icon.ico');
}

main();
