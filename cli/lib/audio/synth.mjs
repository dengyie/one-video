// Procedural, royalty-free background music and sound effects (44.1 kHz stereo WAV).
// Deterministic for a given seed, so re-renders are reproducible.
import { writeWav } from "./wav.mjs";

export const SR = 44100;

const NOTE = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Chord progressions as MIDI roots + intervals; each preset sets mood, tempo and texture.
export const MUSIC_PRESETS = {
  ambient: { bpm: 72, bars: 4, chords: [[57, [0, 7, 12, 16]], [53, [0, 7, 12, 16]], [60, [0, 7, 12, 15]], [55, [0, 7, 12, 14]]], pad: 1, pulse: 0, bass: 0.5, air: 0.25, bright: 0.35 },
  pulse: { bpm: 96, bars: 4, chords: [[57, [0, 7, 12, 15]], [53, [0, 7, 12, 16]], [55, [0, 7, 12, 14]], [52, [0, 7, 12, 15]]], pad: 0.8, pulse: 0.55, bass: 0.7, air: 0.2, bright: 0.5 },
  documentary: { bpm: 60, bars: 4, chords: [[50, [0, 7, 12, 15]], [46, [0, 7, 12, 16]], [53, [0, 7, 12, 16]], [48, [0, 7, 12, 14]]], pad: 1, pulse: 0, bass: 0.6, air: 0.15, bright: 0.2 },
  bright: { bpm: 104, bars: 4, chords: [[60, [0, 7, 12, 16]], [55, [0, 7, 12, 16]], [57, [0, 7, 12, 15]], [53, [0, 7, 12, 16]]], pad: 0.7, pulse: 0.7, bass: 0.6, air: 0.3, bright: 0.7 },
};

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// One-pole low-pass, used for warmth and to shape noise.
function lowpass(buf, cutoffHz) {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / SR);
  let y = 0;
  for (let i = 0; i < buf.length; i++) buf[i] = y = (1 - a) * buf[i] + a * y;
  return buf;
}

export function synthMusic(durationSec, { preset = "ambient", seed = 7 } = {}) {
  const p = MUSIC_PRESETS[preset];
  if (!p) throw new Error(`unknown music preset "${preset}" (${Object.keys(MUSIC_PRESETS).join(", ")})`);
  const n = Math.ceil(durationSec * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const beat = 60 / p.bpm;
  const chordLen = beat * 4 * (p.bars / 2);
  const rand = rng(seed);

  // Pad: detuned saw-ish stack (sum of 4 harmonics), slow attack/release per chord, crossfaded.
  const chordCount = Math.ceil(durationSec / chordLen) + 1;
  for (let c = 0; c < chordCount; c++) {
    const [root, ivs] = p.chords[c % p.chords.length];
    const t0 = c * chordLen;
    const len = chordLen * 1.35;
    const i0 = Math.floor(t0 * SR), i1 = Math.min(n, Math.floor((t0 + len) * SR));
    ivs.forEach((iv, vi) => {
      const f = NOTE(root + iv);
      const pan = (vi / (ivs.length - 1)) * 1.2 - 0.6;
      const detune = [0.997, 1.003];
      const ph = [rand() * 6.28, rand() * 6.28];
      for (let i = i0; i < i1; i++) {
        const t = (i - i0) / SR;
        const env = Math.min(1, t / (chordLen * 0.35)) * Math.min(1, (len - t) / (chordLen * 0.4));
        let sL = 0, sR = 0;
        for (let h = 1; h <= 4; h++) {
          const w = (p.bright * 0.6 + 0.4) / h ** 1.6;
          sL += w * Math.sin(2 * Math.PI * f * detune[0] * h * t + ph[0] * h);
          sR += w * Math.sin(2 * Math.PI * f * detune[1] * h * t + ph[1] * h);
        }
        const g = 0.055 * p.pad * env;
        L[i] += sL * g * (1 - pan * 0.5);
        R[i] += sR * g * (1 + pan * 0.5);
      }
    });
    // Bass: chord root an octave down, sine with soft swell.
    if (p.bass) {
      const f = NOTE(root - 12);
      for (let i = i0; i < Math.min(n, Math.floor((t0 + chordLen) * SR)); i++) {
        const t = (i - i0) / SR;
        const env = Math.min(1, t / 0.6) * Math.min(1, (chordLen - t) / 0.6);
        const s = Math.sin(2 * Math.PI * f * t) * 0.09 * p.bass * env;
        L[i] += s; R[i] += s;
      }
    }
    // Pulse: soft plucked arpeggio on eighth notes for forward motion.
    if (p.pulse) {
      const steps = Math.round(chordLen / (beat / 2));
      for (let k = 0; k < steps; k++) {
        const f = NOTE(root + 12 + ivs[(k * 3) % ivs.length]);
        const s0 = Math.floor((t0 + k * (beat / 2)) * SR);
        const dur = Math.floor(beat * 0.9 * SR);
        const pan = k % 2 ? 0.35 : -0.35;
        const vel = (k % 4 === 0 ? 1 : 0.7) * p.pulse;
        for (let j = 0; j < dur && s0 + j < n; j++) {
          const t = j / SR;
          const s = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 7) * 0.05 * vel;
          L[s0 + j] += s * (1 - pan);
          R[s0 + j] += s * (1 + pan);
        }
      }
    }
  }

  // Air: low-passed noise bed.
  if (p.air) {
    const noise = new Float32Array(n);
    for (let i = 0; i < n; i++) noise[i] = rand() * 2 - 1;
    lowpass(lowpass(noise, 900), 900);
    for (let i = 0; i < n; i++) {
      const lfo = 0.6 + 0.4 * Math.sin((2 * Math.PI * i) / (SR * 11));
      L[i] += noise[i] * 0.05 * p.air * lfo;
      R[i] += noise[(i + 997) % n] * 0.05 * p.air * lfo;
    }
  }
  lowpass(L, 5200 + 4000 * p.bright);
  lowpass(R, 5200 + 4000 * p.bright);

  // Fade in/out and normalize to -3 dBFS peak.
  const fadeIn = 2 * SR, fadeOut = 3 * SR;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const g = Math.min(1, i / fadeIn, (n - i) / fadeOut);
    L[i] *= g; R[i] *= g;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  return interleave(L, R, peak ? 0.707 / peak : 1);
}

function interleave(L, R, gain = 1) {
  const out = new Int16Array(L.length * 2);
  for (let i = 0; i < L.length; i++) {
    out[2 * i] = Math.max(-32768, Math.min(32767, Math.round(L[i] * gain * 32767)));
    out[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(R[i] * gain * 32767)));
  }
  return { samples: out, sampleRate: SR, channels: 2 };
}

const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));

export const SFX = {
  whoosh(rand) {
    const n = Math.floor(0.55 * SR);
    const L = new Float32Array(n), R = new Float32Array(n);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const cutoff = 300 + 5000 * Math.sin((Math.PI * t) / 0.55) ** 2;
      const a = Math.exp((-2 * Math.PI * cutoff) / SR);
      y = (1 - a) * (rand() * 2 - 1) + a * y;
      const g = Math.sin((Math.PI * t) / 0.55) ** 1.5;
      const pan = t / 0.55 - 0.5;
      L[i] = y * g * (1 - pan); R[i] = y * g * (1 + pan);
    }
    return [L, R];
  },
  tick() {
    const n = Math.floor(0.08 * SR);
    const L = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      L[i] = Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 90) * 0.8 + Math.sin(2 * Math.PI * 1200 * t) * Math.exp(-t * 60) * 0.4;
    }
    return [L, L.slice()];
  },
  impact(rand) {
    const n = Math.floor(1.2 * SR);
    const L = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * (40 + 90 * Math.exp(-t * 18))) / SR;
      L[i] = Math.sin(ph) * env(t, 0.004, 0.35) + (rand() * 2 - 1) * Math.exp(-t * 30) * 0.35;
    }
    lowpass(L, 2500);
    return [L, L.slice()];
  },
  riser(rand) {
    const d = 1.6, n = Math.floor(d * SR);
    const L = new Float32Array(n), R = new Float32Array(n);
    let ph = 0, y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * (180 * 2 ** ((t / d) * 2.5))) / SR;
      const a = Math.exp((-2 * Math.PI * (500 + 7000 * (t / d))) / SR);
      y = (1 - a) * (rand() * 2 - 1) + a * y;
      const g = (t / d) ** 2 * Math.min(1, (d - t) / 0.05);
      L[i] = (Math.sin(ph) * 0.4 + y * 0.6) * g;
      R[i] = (Math.sin(ph * 1.004) * 0.4 + y * 0.6) * g;
    }
    return [L, R];
  },
  pop() {
    const n = Math.floor(0.18 * SR);
    const L = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * (600 + 900 * Math.exp(-t * 40))) / SR;
      L[i] = Math.sin(ph) * env(t, 0.002, 0.04);
    }
    return [L, L.slice()];
  },
  chime() {
    const n = Math.floor(1.4 * SR);
    const L = new Float32Array(n), R = new Float32Array(n);
    const fs = [NOTE(84), NOTE(88), NOTE(91)];
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      fs.forEach((f, k) => {
        const tt = t - k * 0.07;
        if (tt < 0) return;
        const s = Math.sin(2 * Math.PI * f * tt) * env(tt, 0.003, 0.45) * 0.33;
        L[i] += s * (k === 0 ? 1.2 : 0.8); R[i] += s * (k === 2 ? 1.2 : 0.8);
      });
    }
    return [L, R];
  },
};

export function synthSfx(name, seed = 3) {
  const gen = SFX[name];
  if (!gen) throw new Error(`unknown sfx "${name}" (${Object.keys(SFX).join(", ")})`);
  const [L, R] = gen(rng(seed));
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  return interleave(L, R, peak ? 0.89 / peak : 1);
}

export function writeMusic(path, durationSec, opts) {
  writeWav(path, synthMusic(durationSec, opts));
}
