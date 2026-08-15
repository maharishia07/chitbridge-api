#!/usr/bin/env node
/**
 * make-test-media.js — deterministic test images, generated rather than downloaded.
 *
 * Athi, 2026-08-15: *"create images if required, need to test those as well."*
 *
 * ⚠️ NOTHING IS FETCHED FROM THE INTERNET. A fixture that downloads a stock photo is a fixture that fails on a
 * train, fails in CI behind a proxy, and raises a licence question nobody wants to answer about a test asset. The
 * storefront CSP blocks external hosts anyway. These are written byte-by-byte from a fixed palette, so the same
 * run always produces the same bytes — which is what lets a test assert a round-trip is IDENTICAL rather than
 * merely non-empty.
 *
 * Usage:  node scripts/make-test-media.js [outDir]
 * Emits:  6 small PNGs + one deliberately oversized file to prove the 6MB refusal still bites.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ── a minimal PNG encoder. Chunk = length, type, data, CRC32 — the format's own rules, nothing clever. ────── */
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
/* Deterministic pseudo-random — a plain LCG, seeded, so "random" bytes are the SAME bytes every run. A test
   fixture that differs between runs cannot assert a byte-identical round-trip. */
function lcg(seed) {
  let s = seed >>> 0;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return (s >>> 16) & 0xFF; };
}
function png(w, h, rgb, noisy) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 2;      // colour type 2 = truecolour RGB
  // 10,11,12 = compression 0, filter 0, interlace 0
  const raw = Buffer.alloc(h * (1 + w * 3));
  const rnd = lcg(20260815);
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;                                   // filter: none
    for (let x = 0; x < w; x++) {
      const p = row + 1 + x * 3;
      if (noisy) {
        /**
         * ⚠️ NOISE, BECAUSE THE FIRST VERSION OF THIS FILE WAS 35KB AND CLAIMED TO BE OVERSIZED.
         *
         * A smooth gradient deflates to almost nothing — a 1800×1800 "large" image compressed to 35,766 bytes,
         * nowhere near the 6MB cap it existed to test. The script's own final check caught it and exited 1,
         * which is the only reason it is not still sitting in the repo pretending to prove something.
         * Incompressible bytes are the point: the cap is about TRANSFERRED SIZE, so the fixture has to be
         * genuinely large, not nominally large.
         */
        raw[p] = rnd(); raw[p + 1] = rnd(); raw[p + 2] = rnd();
      } else {
        // a soft diagonal so the image is not a flat block, and is visibly a picture rather than a swatch
        const shade = ((x + y) % 32) - 16;
        raw[p]     = Math.max(0, Math.min(255, rgb[0] + shade));
        raw[p + 1] = Math.max(0, Math.min(255, rgb[1] + shade));
        raw[p + 2] = Math.max(0, Math.min(255, rgb[2] + shade));
      }
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const PALETTE = [
  ['cement',   [143, 169, 201]],
  ['toor-dal', [201, 180, 143]],
  ['tomato',   [201, 150, 143]],
  ['cable',    [156, 193, 168]],
  ['jute-bag', [169, 156, 201]],
  ['primer',   [201, 192, 143]]
];

function main() {
  const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'test-media'));
  fs.mkdirSync(out, { recursive: true });
  const made = [];
  PALETTE.forEach(([name, rgb]) => {
    const b = png(240, 240, rgb);
    const f = path.join(out, name + '.png');
    fs.writeFileSync(f, b);
    made.push({ file: path.basename(f), bytes: b.length });
  });

  /**
   * ⚠️ THE OVERSIZED ONE MATTERS AS MUCH AS THE REST. MAX_BYTES is 6MB in routes/attachments.js and the client
   * checks it too; a cap that is never tested is a cap that quietly stops working. Base64 inflates by ~33%, so
   * this is sized to be over the limit AFTER encoding as well as before.
   */
  const big = png(1700, 1700, [120, 120, 120], true);   // noisy → incompressible → genuinely over 6MB
  const bigFile = path.join(out, 'oversized.png');
  fs.writeFileSync(bigFile, big);
  made.push({ file: 'oversized.png', bytes: big.length, note: 'must be REFUSED at 6MB' });

  console.log('test media → ' + out);
  made.forEach((m) => console.log('  ' + m.file.padEnd(16) + String(m.bytes).padStart(9) + ' bytes'
    + (m.note ? '   ⚠️ ' + m.note : '')));
  const over = big.length > 6 * 1024 * 1024;
  console.log('\noversized is actually over 6MB: ' + over
    + (over ? '' : '   ⚠️ IT IS NOT — raise the dimensions or this proves nothing'));
  process.exit(over ? 0 : 1);
}
main();
