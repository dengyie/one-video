// Contact sheets: every Nth second of a video tiled into one image, so a whole cut (or a generated
// clip, or two versions of a cut) can be read at a glance by the director or a vision model.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { ffmpeg, ffprobe } from "../core/ffmpeg.mjs";

const CELLS_PER_SHEET = 24;

// Frame grid geometry for [from, to): one cell every 1/fps seconds, sheets of ≤ `per` cells.
export function sheetPlan(duration, { fps, from = 0, to = duration, cols = 6, per = CELLS_PER_SHEET } = {}) {
  const span = Math.max(0, Math.min(to, duration) - from);
  const rate = fps ?? (span <= 75 ? 1 : span <= 150 ? 0.5 : 0.25);
  const step = 1 / rate;
  // Only cells whose sample (mid-interval) is inside the video: a short tail would sample past the end.
  const total = Math.max(1, Math.ceil(span * rate - 0.5 - 1e-6));
  const sheets = [];
  for (let k = 0; k * per < total; k++) {
    const cells = Math.min(per, total - k * per);
    sheets.push({ t0: +(from + k * per * step).toFixed(3), step, cells, cols: Math.min(cols, cells), rows: Math.ceil(cells / Math.min(cols, cells)) });
  }
  return sheets;
}

// The scene playing at t (seconds) on a compiled timeline.
export const sceneAt = (timeline, t) => timeline?.scenes?.findLast((s) => s.start <= t + 1e-6)?.id ?? null;

// Sample mid-interval so a cell shows its second, not the cut at its edge. A sheet written with
// `busy` windows carries the times it actually sampled.
export const cellTime = (s, i) => s.times?.[i] ?? +(s.t0 + s.step * (i + 0.5)).toFixed(2);

// When a compiled timeline is moving rather than holding: transitions across each cut, overlays
// sliding in and out, cued reveals landing. A frame from one of these reads to a vision model as a
// half-drawn or broken frame. Seconds on the timeline.
export function busyWindows(timeline) {
  const fps = timeline?.fps ?? 30, out = [];
  for (const sc of timeline?.scenes ?? []) {
    const tr = sc.transitionIn;
    if (tr?.frames) out.push([sc.start - (tr.lead ?? 0) / fps - 0.15, sc.start + (tr.frames - (tr.lead ?? 0)) / fps + 0.15]);
    for (const o of sc.overlays ?? []) out.push([sc.start + o.t, sc.start + o.t + 0.6], [sc.start + o.end - 0.5, sc.start + o.end]);
    for (const c of Object.values(sc.cues ?? {})) if (Number.isFinite(c) && c > 0.05) out.push([sc.start + c, sc.start + c + 0.6]);
  }
  return out;
}

// The cell's sample moved, inside its own interval, to the nearest moment outside every busy
// window; unchanged when it is already clear or nothing nearby is.
export function settle(t, step, busy) {
  const free = (x) => !busy.some(([a, b]) => x > a && x < b);
  if (!busy?.length || free(t)) return t;
  for (let d = 0.1; d <= step * 0.4 + 1e-6; d += 0.1) for (const x of [t + d, t - d]) if (free(x)) return +x.toFixed(2);
  return t;
}

// Remotion's ffmpeg build has scale but no fps/tile filters, so cells are pulled one by one as raw
// RGB and tiled here; the grid goes out as PNG and ffmpeg re-encodes it to JPEG.
const PAD = 4;

const CRC = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgb, w, h) {
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(rows, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

// Each cell carries its time in the corner (a 3×5 pixel font, no drawtext in this ffmpeg), so a
// reader names the moment it sees instead of counting cells across a 6×4 grid.
const GLYPHS = {
  0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111", 4: "101101111001001",
  5: "111100111001111", 6: "111100111101111", 7: "111001001001001", 8: "111101111101111", 9: "111101111001111",
  ".": "000000000000010", s: "000011110001110",
};
export function stampTime(grid, W, x0, y0, text, scale = 3) {
  const chars = [...text].filter((c) => GLYPHS[c]);
  const bw = (chars.length * 4 + 1) * scale, bh = 7 * scale;
  for (let y = 0; y < bh; y++) grid.fill(0, ((y0 + y) * W + x0) * 3, ((y0 + y) * W + x0 + bw) * 3);
  chars.forEach((c, n) => {
    for (let k = 0; k < 15; k++) {
      if (GLYPHS[c][k] !== "1") continue;
      const px = x0 + (1 + n * 4 + (k % 3)) * scale, py = y0 + (1 + Math.floor(k / 3)) * scale;
      for (let y = 0; y < scale; y++) grid.fill(255, ((py + y) * W + px) * 3, ((py + y) * W + px + scale) * 3);
    }
  });
}
const stampText = (t) => `${+t.toFixed(2)}s`;

async function frameRgb(video, t, w, h, tmp) {
  const f = join(tmp, `cell-${Math.random().toString(36).slice(2)}.rgb`);
  if (t < 0) return null;
  await ffmpeg(["-y", "-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-pix_fmt", "rgb24", "-c:v", "rawvideo", "-f", "image2", "-update", "1", f]);
  if (!existsSync(f)) return null; // past the last frame: leave the cell black
  const buf = readFileSync(f);
  rmSync(f, { force: true });
  return buf;
}

// `shift` moves the stamped times onto the timeline (a part render starts later).
// `busy` (video seconds, see busyWindows) nudges each cell off transitions and entrances.
// `pair: { video, shift }` stacks a second video into every cell (it on top, this one below), at
// the same moment shifted by `shift` seconds: an older version of the cut against the new one.
export async function writeSheets(video, outDir, opts = {}) {
  const probe = await ffprobe(video);
  const duration = +probe.format.duration;
  const vs = probe.streams.find((st) => st.codec_type === "video");
  const plan = sheetPlan(duration, opts);
  const prefix = opts.prefix ?? "sheet";
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (new RegExp(`^${prefix}-\\d+\\.jpg$`).test(f)) rmSync(join(outDir, f));
  const w = opts.width ?? 480, h = Math.round((w * vs.height) / vs.width / 2) * 2;
  const pair = opts.pair ? { ...opts.pair, duration: +(await ffprobe(opts.pair.video)).format.duration } : null;
  const ch = pair ? 2 * h + PAD : h;
  const tmp = mkdtempSync(join(tmpdir(), "ov-sheet-"));
  const grab = (file, dur, t) => (t >= dur ? null : frameRgb(file, Math.min(t, dur - 0.05), w, h, tmp));
  try {
    for (const [k, s] of plan.entries()) {
      s.file = join(outDir, `${prefix}-${String(k + 1).padStart(2, "0")}.jpg`);
      if (opts.busy?.length) s.times = Array.from({ length: s.cells }, (_, i) => settle(cellTime(s, i), s.step, opts.busy));
      const W = s.cols * w + (s.cols + 1) * PAD, H = s.rows * ch + (s.rows + 1) * PAD;
      const grid = Buffer.alloc(W * H * 3);
      const blit = (cell, x0, y0) => { for (let y = 0; y < h; y++) cell.copy(grid, ((y0 + y) * W + x0) * 3, y * w * 3, (y + 1) * w * 3); };
      for (let i0 = 0; i0 < s.cells; i0 += 4) {
        const idx = Array.from({ length: Math.min(4, s.cells - i0) }, (_, d) => i0 + d);
        const cells = await Promise.all(idx.map((i) => grab(video, duration, cellTime(s, i))));
        const tops = pair ? await Promise.all(idx.map((i) => grab(pair.video, pair.duration, cellTime(s, i) + pair.shift))) : [];
        for (const [n, i] of idx.entries()) {
          const x0 = PAD + (i % s.cols) * (w + PAD), y0 = PAD + Math.floor(i / s.cols) * (ch + PAD);
          if (tops[n]) blit(tops[n], x0, y0);
          if (cells[n]) blit(cells[n], x0, pair ? y0 + h + PAD : y0);
          if (opts.stamp !== false) stampTime(grid, W, x0, y0, stampText(cellTime(s, i) + (opts.shift ?? 0)), Math.max(2, Math.round(w / 160)));
        }
      }
      const png = join(tmp, "sheet.png");
      writeFileSync(png, encodePng(grid, W, H));
      await ffmpeg(["-y", "-v", "error", "-i", png, "-q:v", "4", s.file]);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { duration, width: vs.width, height: vs.height, sheets: plan };
}

// Still images (one per scene moment) tiled the same way: the pre-render preview. `cells` are
// { file, t } with t the timeline second stamped in the corner; sheets of ≤ `per` cells.
export async function writeImageSheets(cells, outDir, { prefix = "preview", cols = 4, width = 480, per = CELLS_PER_SHEET } = {}) {
  if (!cells.length) return [];
  const vs = (await ffprobe(cells[0].file)).streams.find((st) => st.codec_type === "video");
  const w = width, h = Math.round((w * vs.height) / vs.width / 2) * 2;
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (new RegExp(`^${prefix}-\\d+\\.jpg$`).test(f)) rmSync(join(outDir, f));
  const tmp = mkdtempSync(join(tmpdir(), "ov-preview-"));
  const sheets = [];
  try {
    for (let k = 0; k * per < cells.length; k++) {
      const part = cells.slice(k * per, (k + 1) * per);
      const c = Math.min(cols, part.length), rows = Math.ceil(part.length / c);
      const W = c * w + (c + 1) * PAD, H = rows * h + (rows + 1) * PAD;
      const grid = Buffer.alloc(W * H * 3);
      for (const [i, cell] of part.entries()) {
        const f = join(tmp, `cell-${i}.rgb`);
        await ffmpeg(["-y", "-v", "error", "-i", cell.file, "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-pix_fmt", "rgb24", "-c:v", "rawvideo", "-f", "image2", "-update", "1", f]);
        const rgb = readFileSync(f);
        const x0 = PAD + (i % c) * (w + PAD), y0 = PAD + Math.floor(i / c) * (h + PAD);
        for (let y = 0; y < h; y++) rgb.copy(grid, ((y0 + y) * W + x0) * 3, y * w * 3, (y + 1) * w * 3);
        stampTime(grid, W, x0, y0, stampText(cell.t), Math.max(2, Math.round(w / 160)));
      }
      const png = join(tmp, "sheet.png"), file = join(outDir, `${prefix}-${String(k + 1).padStart(2, "0")}.jpg`);
      writeFileSync(png, encodePng(grid, W, H));
      await ffmpeg(["-y", "-v", "error", "-i", png, "-q:v", "4", file]);
      sheets.push({ file, cells: part.length, cols: c, rows });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return sheets;
}
