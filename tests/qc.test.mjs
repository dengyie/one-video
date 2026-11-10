import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { decodeGrayPng, runs, analyzeFrames, QC_DEFAULTS } from "../cli/lib/vision/qc.mjs";

function crcTable() {
  return Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
}
const T = crcTable();
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = T[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
// Gray PNG whose rows use filter types 0..4 in turn, to exercise every unfilter path.
function grayPng(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = [];
  for (let y = 0; y < h; y++) {
    const ft = y % 5;
    raw.push(ft);
    for (let x = 0; x < w; x++) {
      const a = x ? px[y * w + x - 1] : 0, b = y ? px[(y - 1) * w + x] : 0, c = x && y ? px[(y - 1) * w + x - 1] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][ft];
      raw.push((px[y * w + x] - pred) & 255);
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(raw))), chunk("IEND", Buffer.alloc(0))]);
}

test("decodeGrayPng handles all five filter types", () => {
  const w = 7, h = 10;
  const px = Uint8Array.from({ length: w * h }, (_, i) => (i * 37 + (i % 5) * 11) & 255);
  const d = decodeGrayPng(grayPng(w, h, px));
  assert.equal(d.width, w);
  assert.equal(d.height, h);
  assert.deepEqual(Array.from(d.pixels), Array.from(px));
});

test("runs groups consecutive flags into second ranges", () => {
  assert.deepEqual(runs([false, true, true, false, true], 0.5), [[0.5, 1.5], [2, 2.5]]);
});

const frame = (v, n = 64) => Uint8Array.from({ length: n }, () => v);

test("analyzeFrames finds interior black runs and long frozen segments", () => {
  const fps = 2;
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(frame(i < 4 ? 100 + i * 10 : i < 8 ? 0 : 128)); // motion, black 2s, then frozen 16s
  const r = analyzeFrames(frames, fps, QC_DEFAULTS);
  assert.equal(r.black.length, 1);
  assert.deepEqual(r.black[0], [2, 4]);
  assert.ok(r.frozen.some(([a, b]) => b - a > QC_DEFAULTS.frozen.maxRun));
  assert.ok(r.staticRatio > 0.5);
});

test("analyzeFrames compares against the frame one window back, so slow drift is motion", () => {
  const fps = 2;
  // One more pixel brightens each sample: mean diff 0.5 vs the previous sample (< 0.6), 1.0 vs two back.
  const drift = Array.from({ length: 40 }, (_, i) => Uint8Array.from({ length: 64 }, (_, j) => (j < i ? 132 : 100)));
  const lagged = analyzeFrames(drift, fps, QC_DEFAULTS);
  const adjacent = analyzeFrames(drift, fps, { ...QC_DEFAULTS, frozen: { ...QC_DEFAULTS.frozen, window: 0.5 } });
  assert.equal(lagged.staticRatio, 0);
  assert.ok(adjacent.staticRatio > 0.9);
});
