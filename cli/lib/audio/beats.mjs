// Music beat grid for cutting on the beat. Synthesized music knows its tempo; a provided track is
// decoded once with the bundled ffmpeg and analysed (onset envelope → tempo by autocorrelation →
// phase), and the grid is cached next to the track as <file>.beats.json for the sync compiler.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ffmpeg } from "../core/ffmpeg.mjs";
import { readWav, toMono } from "./wav.mjs";

export const beatsFile = (musicPath) => `${musicPath}.beats.json`;

export function gridBeats(bpm, duration, offset = 0) {
  const step = 60 / bpm;
  const out = [];
  for (let t = offset; t <= duration + 1e-6; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}

// Onset strength per hop: rise in log energy of the first-differenced (high-passed) signal.
export function onsetEnvelope(mono, sr, hop = 512) {
  const n = Math.floor(mono.length / hop);
  const env = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = i * hop + 1; j < (i + 1) * hop; j++) { const d = mono[j] - mono[j - 1]; e += d * d; }
    const l = Math.log(1e-9 + e);
    env[i] = i ? Math.max(0, l - prev) : 0;
    prev = l;
  }
  // Remove the local mean so sustained loud passages don't count as onsets.
  const out = new Float32Array(n);
  const W = 16;
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - W); k < Math.min(n, i + W); k++) { s += env[k]; c++; }
    out[i] = Math.max(0, env[i] - s / c);
  }
  return { env: out, rate: sr / hop };
}

const sampleAt = (env, x) => {
  const i = Math.floor(x), f = x - i;
  return i + 1 < env.length ? env[i] * (1 - f) + env[i + 1] * f : 0;
};

// Tempo in 70–180 BPM (weighted toward ~110, where most produced music sits), then the phase
// whose grid collects the most onset energy.
export function detectBeats(mono, sr) {
  const { env, rate } = onsetEnvelope(mono, sr);
  const duration = mono.length / sr;
  let best = { score: -1, bpm: 120 };
  for (let bpm = 70; bpm <= 180; bpm += 0.25) {
    const lag = (60 / bpm) * rate;
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += env[i] * sampleAt(env, i + lag);
    const w = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.6) ** 2);
    if (s * w > best.score) best = { score: s * w, bpm };
  }
  // Tempo and phase together, finely around the autocorrelation peak: a grid that is 0.2 BPM off
  // drifts a beat by a hop or two over a few minutes, so refine both against the onsets. The
  // autocorrelation peak is broad (accents and the tempo prior can pull it a couple of BPM off),
  // so the sharper phase score gets ±2.5 BPM to correct it.
  let phase = { score: -1, at: 0, bpm: best.bpm };
  for (let bpm = best.bpm - 2.5; bpm <= best.bpm + 2.5 + 1e-9; bpm += 0.05) {
    const period = (60 / bpm) * rate;
    for (let p = 0; p < period; p += 0.25) {
      let s = 0;
      for (let x = p; x < env.length; x += period) s += sampleAt(env, x);
      if (s > phase.score) phase = { score: s, at: p, bpm };
    }
  }
  const bpm = Math.round(phase.bpm * 100) / 100;
  const beats = gridBeats(bpm, duration, phase.at / rate);
  // Bar phase: in 4/4 the downbeat carries the most onset energy of the four beat positions.
  const bar = [0, 1, 2, 3].map((k) => beats.reduce((s, b, i) => (i % 4 === k ? s + sampleAt(env, b * rate) : s), 0));
  return { bpm, beats, downbeats: everyFourth(beats, bar.indexOf(Math.max(...bar))) };
}

export const everyFourth = (beats, k = 0) => beats.filter((_, i) => i % 4 === k);

// Beat grid for the timeline's music, cached. Returns null when there is no music file.
export async function ensureBeats(root, music, { preset } = {}) {
  const file = join(root, "public", music.src);
  if (!existsSync(file)) return null;
  const cache = beatsFile(file);
  // Caches from before downbeat detection are re-analysed once.
  if (existsSync(cache)) { const c = JSON.parse(readFileSync(cache, "utf8")); if (c.downbeats || String(c.source).startsWith("synth:")) return c; }
  let w;
  if (/\.wav$/i.test(file)) w = readWav(file);
  else {
    // Other formats are decoded to a temporary WAV, removed once read.
    const wav = join(tmpdir(), `onevideo-beats-${process.pid}.wav`);
    try {
      await ffmpeg(["-y", "-v", "error", "-i", file, "-ac", "1", "-ar", "22050", "-c:a", "pcm_s16le", wav]);
      w = readWav(wav);
    } finally {
      rmSync(wav, { force: true });
    }
  }
  const res = { ...detectBeats(toMono(w, w.sampleRate), w.sampleRate), source: preset ? `synth:${preset}` : "detected" };
  writeFileSync(cache, JSON.stringify(res));
  return res;
}

// Cuts land on the bar: a downbeat within 0.25 s wins, else the nearest beat within `window`.
export function snapToBar(t, beats, downbeats = [], window = 0.12) {
  const d = snapToBeat(t, downbeats, 0.25);
  return d !== t ? d : snapToBeat(t, beats, window);
}

// Nearest beat within `window` seconds of t (absolute times), else t.
export function snapToBeat(t, beats, window = 0.15) {
  let best = t, d = window;
  for (const b of beats) {
    const x = Math.abs(b - t);
    if (x <= d) { d = x; best = b; }
    if (b > t + window) break;
  }
  return best;
}
