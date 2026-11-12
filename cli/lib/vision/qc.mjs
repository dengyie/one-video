// Post-render quality control: container/stream checks, loudness, silence gaps,
// black frames, frozen/slideshow segments, and per-scene frame samples for visual review.
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { ffmpeg, ffprobe } from "../core/ffmpeg.mjs";
import { pool } from "../core/http.mjs";

export const QC_DEFAULTS = {
  loudness: { target: -16, tolerance: 2, maxTruePeak: -1 },
  durationTolerance: 0.5,
  silence: { noiseDb: -45, maxGap: 1.2 },
  black: { luma: 10, maxRun: 0.6 },
  // A sample is static when it barely differs from the one `window` seconds earlier,
  // so slow continuous drift counts as motion, as the viewer perceives it.
  frozen: { diff: 0.6, maxRun: 8, window: 1 },
  staticRatioMax: 0.45,
  sampleFps: 2,
};

// Minimal PNG decoder for 8-bit grayscale, non-interlaced images (what ffmpeg emits with format=gray).
export function decodeGrayPng(buf) {
  let off = 8, w = 0, h = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 0 || data[12] !== 0) throw new Error("expected 8-bit gray non-interlaced PNG");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (w + 1)];
    const row = raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1));
    for (let x = 0; x < w; x++) {
      const a = x > 0 ? px[y * w + x - 1] : 0;
      const b = y > 0 ? px[(y - 1) * w + x] : 0;
      const c = x > 0 && y > 0 ? px[(y - 1) * w + x - 1] : 0;
      let v = row[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * w + x] = v & 255;
    }
  }
  return { width: w, height: h, pixels: px };
}

// Group consecutive true flags into [startSec, endSec] runs.
export function runs(flags, step) {
  const out = [];
  let s = -1;
  flags.forEach((f, i) => {
    if (f && s < 0) s = i;
    if (!f && s >= 0) { out.push([s * step, i * step]); s = -1; }
  });
  if (s >= 0) out.push([s * step, flags.length * step]);
  return out;
}

export function analyzeFrames(frames, fps, t = QC_DEFAULTS) {
  const step = 1 / fps;
  const means = frames.map((f) => f.reduce((s, v) => s + v, 0) / f.length);
  const lag = Math.max(1, Math.round((t.frozen.window ?? step) * fps));
  const diffs = frames.map((f, i) => {
    if (i < lag) return Infinity;
    const p = frames[i - lag];
    let d = 0;
    for (let j = 0; j < f.length; j++) d += Math.abs(f[j] - p[j]);
    return d / f.length;
  });
  const total = frames.length * step;
  const black = runs(means.map((m) => m < t.black.luma), step)
    .filter(([a, b]) => b - a > t.black.maxRun && a > 0.5 && b < total - 0.5);
  const staticFlags = diffs.map((d) => d < t.frozen.diff);
  const frozen = runs(staticFlags, step).filter(([a, b]) => b - a > t.frozen.maxRun);
  const staticRatio = staticFlags.filter(Boolean).length / Math.max(1, frames.length);
  return { black, frozen, staticRatio, means, diffs };
}

function parseLoudnorm(stderr) {
  const m = stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!m) return null;
  const j = JSON.parse(m[0]);
  return { integrated: Number(j.input_i), truePeak: Number(j.input_tp), lra: Number(j.input_lra) };
}

function parseSilence(stderr) {
  const out = [];
  let start = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (s) start = Number(s[1]);
    if (e && start !== null) { out.push([Math.max(0, start), Number(e[1])]); start = null; }
  }
  return out;
}

// A part render starts `offset` seconds into the timeline and runs `span` seconds: the duration
// check, the narration intervals and the scene samples are taken on the file's own clock.
export async function runQc({ video, timeline, outDir, thresholds = {}, offset = 0, span = timeline.duration - offset }) {
  const t = deepMerge(QC_DEFAULTS, thresholds);
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });

  const probe = await ffprobe(video);
  const v = probe.streams.find((s) => s.codec_type === "video");
  const a = probe.streams.find((s) => s.codec_type === "audio");
  const duration = Number(probe.format.duration);
  if (!v) add("video-stream", "fail", "no video stream");
  else {
    add("video-codec", v.codec_name === "h264" ? "pass" : "warn", `${v.codec_name} ${v.pix_fmt}`);
    add("resolution", v.width === timeline.width && v.height === timeline.height ? "pass" : "fail", `${v.width}x${v.height} (expected ${timeline.width}x${timeline.height})`);
    const [num, den] = String(v.r_frame_rate).split("/").map(Number);
    const fps = den ? num / den : num;
    add("fps", Math.abs(fps - timeline.fps) < 0.01 ? "pass" : "fail", `${fps.toFixed(3)} fps (expected ${timeline.fps})`);
  }
  if (!a) add("audio-stream", "fail", "no audio stream");
  else add("audio-codec", a.codec_name === "aac" ? "pass" : "warn", `${a.codec_name} ${a.sample_rate}Hz ${a.channels}ch`);
  add("duration", Math.abs(duration - span) <= t.durationTolerance ? "pass" : "fail", `${duration.toFixed(2)}s (${offset ? `part from ${offset}s: ${+span.toFixed(2)}` : `timeline ${timeline.duration}`}s)`);

  let loud = null, silences = [];
  if (a) {
    const { stderr } = await ffmpeg(["-i", video, "-vn", "-af", `silencedetect=noise=${t.silence.noiseDb}dB:d=${t.silence.maxGap},loudnorm=I=${t.loudness.target}:TP=${t.loudness.maxTruePeak}:print_format=json`, "-f", "null", "-"]);
    loud = parseLoudnorm(stderr);
    silences = parseSilence(stderr).filter(([s, e]) => s > 0.5 && e < duration - 1);
    if (loud) {
      const off = Math.abs(loud.integrated - t.loudness.target);
      add("loudness", off <= t.loudness.tolerance ? "pass" : off <= t.loudness.tolerance * 2 ? "warn" : "fail", `${loud.integrated.toFixed(1)} LUFS (target ${t.loudness.target}±${t.loudness.tolerance})`);
      add("true-peak", loud.truePeak <= t.loudness.maxTruePeak ? "pass" : "warn", `${loud.truePeak.toFixed(1)} dBTP (max ${t.loudness.maxTruePeak})`);
    } else add("loudness", "warn", "loudnorm produced no measurement");
    // Silence during a narration interval means a dropped TTS line: fail. Elsewhere it is only dead air.
    const inSpeech = silences.filter(([s, e]) => (timeline.narration ?? []).some(([a, b]) => s < b - offset - 0.2 && e > a - offset + 0.2));
    const fmtS = (rs) => rs.map(([s, e]) => `${s.toFixed(1)}–${e.toFixed(1)}s`).join(", ");
    add("silence-in-narration", inSpeech.length ? "fail" : "pass", inSpeech.length ? fmtS(inSpeech) : "narration audible throughout");
    add("dead-air", silences.length > inSpeech.length ? "warn" : "pass", silences.length ? fmtS(silences) : `no gap > ${t.silence.maxGap}s`);
  }

  const grayDir = join(outDir, ".gray");
  rmSync(grayDir, { recursive: true, force: true });
  mkdirSync(grayDir, { recursive: true });
  // Remotion's bundled ffmpeg has no fps/select filter: export every frame tiny, then subsample.
  const step = Math.max(1, Math.round(timeline.fps / t.sampleFps));
  await ffmpeg(["-i", video, "-an", "-vf", "scale=64:36,format=gray", "-c:v", "png", "-f", "image2", join(grayDir, "%05d.png")]);
  const frames = readdirSync(grayDir).filter((f) => f.endsWith(".png")).sort()
    .filter((_, i) => i % step === 0)
    .map((f) => decodeGrayPng(readFileSync(join(grayDir, f))).pixels);
  rmSync(grayDir, { recursive: true, force: true });
  const fa = analyzeFrames(frames, timeline.fps / step, t);
  const fmt = (rs) => rs.map(([s, e]) => `${s.toFixed(1)}–${e.toFixed(1)}s`).join(", ");
  add("black-frames", fa.black.length ? "fail" : "pass", fa.black.length ? fmt(fa.black) : "none");
  add("frozen-segments", fa.frozen.length ? "warn" : "pass", fa.frozen.length ? `${fmt(fa.frozen)} (> ${t.frozen.maxRun}s without motion)` : "none");
  add("static-ratio", fa.staticRatio <= t.staticRatioMax ? "pass" : "warn", `${(fa.staticRatio * 100).toFixed(0)}% of samples nearly static (max ${(t.staticRatioMax * 100).toFixed(0)}%)`);

  // One frame per scene at 60% of its length (after entrances settle) for visual review.
  const framesDir = join(outDir, "frames");
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const samples = timeline.scenes.map((s, i) => ({ scene: s.id, type: s.type, at: Math.max(0, Math.min(duration - 0.05, s.start + s.duration * 0.6 - offset)), file: join(framesDir, `${String(i + 1).padStart(2, "0")}-${s.id}.jpg`), inFile: s.start + s.duration > offset && s.start < offset + duration }))
    .filter((x) => x.inFile);
  await pool(samples, 4, (s) => ffmpeg(["-ss", s.at.toFixed(3), "-i", video, "-frames:v", "1", "-vf", "scale=960:-2", "-c:v", "mjpeg", "-q:v", "4", "-y", s.file]));

  const verdict = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "pass";
  return {
    checkedAt: new Date().toISOString(),
    video,
    verdict,
    probe: { duration, width: v?.width, height: v?.height, videoCodec: v?.codec_name, audioCodec: a?.codec_name, sizeBytes: Number(probe.format.size) },
    loudness: loud,
    checks,
    frames: samples.map(({ scene, type, at, file }) => ({ scene, type, at: Math.round((at + offset) * 100) / 100, file })),
  };
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge(a[k] ?? {}, v) : v;
  return out;
}
