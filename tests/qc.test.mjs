import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { ffmpeg } from "../cli/lib/core/ffmpeg.mjs";
import { decodeGrayPng, runs, analyzeFrames, QC_DEFAULTS, runQc, sampleGrayFrames, voiceGaps } from "../cli/lib/vision/qc.mjs";
import { readWav, writeWav } from "../cli/lib/audio/wav.mjs";

test("voice QC catches silent lines at the edges and confines findings to the rendered part", () => {
  const dir = mkdtempSync(join(tmpdir(), "ov-voice-qc-"));
  try {
    const audio = "narrator.wav", sampleRate = 8000;
    const samples = Int16Array.from({ length: 4 * sampleRate }, (_, i) => i >= sampleRate && i < 2 * sampleRate ? 6500 * Math.sin(i / 10) : 0);
    writeWav(join(dir, audio), { channels: 1, sampleRate, samples });
    const timeline = { duration: 7, scenes: [{ start: 3, duration: 4, audio, lines: [
      { start: 0, end: 1 }, { start: 1, end: 2 }, { start: 3, end: 4 },
    ] }] };
    const readVoice = (file) => readWav(join(dir, file));
    assert.deepEqual(voiceGaps(timeline, { readVoice }), [[3, 4], [6, 7]]);
    assert.deepEqual(voiceGaps(timeline, { readVoice, offset: 4, span: 2.5 }), [[2, 2.5]]);
    assert.deepEqual(voiceGaps(timeline, { readVoice: (file) => readWav(join(dir, "missing", file)) }), [[3, 4], [4, 5], [6, 7]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

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

test("black-frame QC separates dark content from near-black noise", () => {
  const dark = Uint8Array.from({ length: 64 * 36 }, (_, i) => i < 12 ? 52 : 4);
  const blank = Uint8Array.from({ length: 64 * 36 }, (_, i) => i === 0 ? 48 : i % 5);
  const report = analyzeFrames([frame(80), frame(80), dark, dark, blank, blank, frame(80), frame(80)], 2);
  assert.ok(report.means[2] < QC_DEFAULTS.black.luma);
  assert.deepEqual(report.black, [[2, 3]]);
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

test("bundled FFmpeg QC samples the same frames as the PNG pipeline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ov-qc-"));
  try {
    const video = join(dir, "cut.mp4"), png = join(dir, "png"), outDir = join(dir, "qc");
    mkdirSync(png);
    for (let i = 0; i < 32; i++) {
      const luma = i >= 8 && i < 16 ? 0 : 60 + i * 4;
      writeFileSync(join(dir, `in${String(i).padStart(2, "0")}.png`), grayPng(64, 36, frame(luma, 64 * 36)));
    }
    await ffmpeg(["-framerate", "8", "-start_number", "0", "-i", join(dir, "in%02d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
    await ffmpeg(["-i", video, "-an", "-vf", "scale=64:36,format=gray", "-c:v", "png", "-f", "image2", join(png, "%05d.png")]);
    const legacy = readdirSync(png).sort().filter((_, i) => i % 4 === 0)
      .map((file) => decodeGrayPng(readFileSync(join(png, file))).pixels);
    const samples = await sampleGrayFrames(video, 4);
    assert.deepEqual(samples.map((x) => new Uint8Array(x)), legacy);
    const timeline = { width: 64, height: 36, fps: 8, duration: 4, scenes: [{ id: "one", type: "test", start: 0, duration: 4, lines: [{ start: 0.5, end: 2.5 }] }] };
    const report = await runQc({ video, timeline, outDir, readVoice: (file) => readWav(join(dir, file)) });
    assert.equal(report.verdict, "fail");
    assert.deepEqual(report.checks.find((c) => c.id === "black-frames"), { id: "black-frames", status: "fail", detail: "1.0–2.0s" });
    assert.deepEqual(report.checks.find((c) => c.id === "silence-in-narration"), { id: "silence-in-narration", status: "fail", detail: "silent or missing voice stem: 0.5–2.5s" });
    assert.equal(report.frames.length, 1);
    assert.deepEqual(readdirSync(outDir), ["frames"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
