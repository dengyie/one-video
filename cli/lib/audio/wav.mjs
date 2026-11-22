// 16-bit PCM WAV read/write/concat with no dependencies.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// strict: a data chunk shorter than its declared size is an error (a truncated download), unless
// the size is a streaming placeholder (0 or ~4 GiB).
export function parseWav(buf, { strict = false } = {}) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let off = 12, fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      fmt = {
        format: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bits: buf.readUInt16LE(off + 22),
      };
    }
    if (id === "data") {
      if (!fmt) throw new Error("wav data before fmt chunk");
      if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`unsupported wav encoding (format ${fmt.format}, ${fmt.bits}-bit); need 16-bit PCM`);
      // Streamed WAVs may carry a placeholder data size; trust the bytes present.
      if (strict && size > 0 && size < 0xfffffff0 && buf.length - off - 8 < size) throw new Error(`wav truncated: data chunk has ${buf.length - off - 8} of ${size} bytes`);
      const bytes = Math.min(size, buf.length - off - 8) & ~1;
      const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset + off + 8, buf.byteOffset + off + 8 + bytes));
      return { ...fmt, samples: pcm, duration: pcm.length / fmt.channels / fmt.sampleRate };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("wav has no data chunk");
}

export const readWav = (path) => parseWav(readFileSync(path));

export function encodeWav({ samples, sampleRate, channels }) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export function writeWav(path, wav) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodeWav(wav));
}

// Convert to mono at the target rate (linear interpolation is fine for speech).
export function toMono(wav, sampleRate) {
  const { samples, channels } = wav;
  const frames = samples.length / channels;
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += samples[i * channels + c];
    mono[i] = s / channels;
  }
  if (wav.sampleRate === sampleRate) return mono;
  const ratio = wav.sampleRate / sampleRate;
  const out = new Float32Array(Math.floor(frames / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio, i0 = Math.floor(x), f = x - i0;
    out[i] = mono[i0] * (1 - f) + (mono[Math.min(i0 + 1, frames - 1)] ?? 0) * f;
  }
  return out;
}

// Trim leading/trailing near-silence so measured line durations reflect speech.
export function trimSilence(mono, sampleRate, { threshold = 250, keepMs = 40 } = {}) {
  const win = Math.max(1, Math.round(sampleRate * 0.01));
  const loud = (i) => {
    let m = 0;
    for (let j = i; j < Math.min(i + win, mono.length); j++) m = Math.max(m, Math.abs(mono[j]));
    return m > threshold;
  };
  let a = 0, b = mono.length;
  while (a < b && !loud(a)) a += win;
  while (b > a && !loud(Math.max(a, b - win))) b -= win;
  const keep = Math.round((sampleRate * keepMs) / 1000);
  return mono.subarray(Math.max(0, a - keep), Math.min(mono.length, b + keep));
}

// Join clips with silence gaps; returns PCM plus each clip's [start, end] in seconds.
export function concatWithGaps(clips, gapsSec, sampleRate) {
  const gapFrames = gapsSec.map((g) => Math.round(g * sampleRate));
  const total = clips.reduce((s, c) => s + c.length, 0) + gapFrames.reduce((s, g) => s + g, 0);
  const out = new Int16Array(total);
  const spans = [];
  let pos = 0;
  clips.forEach((c, i) => {
    const start = pos;
    for (let j = 0; j < c.length; j++) out[pos + j] = Math.max(-32768, Math.min(32767, Math.round(c[j])));
    pos += c.length;
    spans.push([start / sampleRate, pos / sampleRate]);
    pos += gapFrames[i] ?? 0;
  });
  return { samples: out, spans, duration: total / sampleRate };
}

// Quiet stretches inside speech, as [start, end] seconds. The level threshold follows the clip's
// peak, so a soft voice still shows its pauses.
export function findPauses(mono, sampleRate, { minMs = 90, relative = 0.04, floor = 250 } = {}) {
  const win = Math.max(1, Math.round(sampleRate * 0.01));
  let peak = 0;
  for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));
  const threshold = Math.max(floor, peak * relative);
  const out = [];
  let quietFrom = -1;
  for (let i = 0; i < mono.length; i += win) {
    let m = 0;
    for (let j = i; j < Math.min(i + win, mono.length); j++) m = Math.max(m, Math.abs(mono[j]));
    if (m <= threshold) { if (quietFrom < 0) quietFrom = i; continue; }
    if (quietFrom >= 0 && (i - quietFrom) * 1000 >= minMs * sampleRate) out.push([quietFrom / sampleRate, i / sampleRate]);
    quietFrom = -1;
  }
  return out;
}

// Change the pace of speech without changing its pitch (WSOLA): 30 ms Hann frames laid down at a
// fixed hop, each read from where the faster (or slower) clock says it should start, nudged up to
// ±10 ms to the offset that best continues the frame before it, so the waveform stays in phase.
// `factor` > 1 speaks faster (the clip gets shorter by that factor).
export function timeStretch(mono, sampleRate, factor) {
  if (!(factor > 0) || Math.abs(factor - 1) < 1e-3 || mono.length === 0) return mono;
  const N = 2 * Math.round(sampleRate * 0.015);
  const hop = N / 2;
  const tol = Math.round(sampleRate * 0.01);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const outLen = Math.max(1, Math.round(mono.length / factor));
  const out = new Float32Array(outLen + N);
  const weight = new Float32Array(outLen + N);
  const at = (i) => (i >= 0 && i < mono.length ? mono[i] : 0);
  let prev = 0; // where the last frame was read from
  for (let k = 0; k * hop < outLen; k++) {
    const nominal = Math.round(k * hop * factor);
    let start = nominal;
    if (k > 0) {
      // The natural continuation of the previous frame; pick the read offset most like it.
      const ref = prev + hop;
      let best = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const s = nominal + d;
        if (s < 0) continue;
        let c = 0;
        for (let j = 0; j < N; j += 4) c += at(s + j) * at(ref + j);
        if (c > best) { best = c; start = s; }
      }
    }
    const o = k * hop;
    for (let j = 0; j < N; j++) {
      out[o + j] += win[j] * at(start + j);
      weight[o + j] += win[j];
    }
    prev = start;
  }
  const res = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) res[i] = weight[i] > 1e-3 ? out[i] / weight[i] : out[i];
  return res;
}
