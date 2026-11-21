// Scored music: a procedural track that tells the video's story instead of looping one mood.
// The arc follows the script's beats (hook → intro, build → rise, turn, climax, landing → resolve),
// placed on the cut's own scene starts and snapped to bars, so the music turns where the story does.
// One leitmotif carries through: a music box in the intro, a voice as it builds, broken up in the
// turn, an octave up with a harmony over drums at the climax, and slowed back to the box to end on
// the tonic. Fixed tempo, so the beat grid stays exact. Deterministic for a given seed.
import { writeWav } from "./wav.mjs";
import { SR, NOTE, rng, interleave } from "./synth.mjs";

export const STORY_BPM = 80;
export const MOODS = ["intro", "rise", "turn", "climax", "resolve"];
export const BEAT_MOOD = { hook: "intro", setup: "intro", build: "rise", turn: "turn", climax: "climax", landing: "resolve", credits: "resolve" };

// Where each mood starts as a share of the length when the script names no beats.
const DEFAULT_ARC = [["intro", 0], ["rise", 0.2], ["turn", 0.45], ["climax", 0.62], ["resolve", 0.85]];

// The leitmotif, one bar per pattern: [chord-tone index, beats]. Tone indices run up the chord
// (root, third, fifth, octave, tenth, twelfth), so the line is consonant on every chord.
const P = {
  a: [[2, 1], [3, 0.5], [4, 0.5], [3, 1.5], [2, 0.5]],
  b: [[4, 1], [3, 0.5], [2, 0.5], [1, 1], [2, 1]],
  c: [[3, 1.5], [4, 0.5], [5, 1], [4, 1]],
  d: [[2, 2], [1, 1], [0, 1]],
  slowA: [[2, 1], [3, 1], [4, 2]],
  slowB: [[3, 1], [2, 1], [1, 2]],
  frag: [[2, 1], [3, 0.5], [null, 2.5]],
  fragB: [[null, 2], [1, 1], [0, 1]],
};

// Key of C major / A minor; one chord per bar. level is the section's loudness before the final
// normalisation, so the climax is the loudest moment and the ending the quietest.
const MOOD = {
  intro: { chords: [[57, [0, 3, 7, 12]], [53, [0, 4, 7, 12]], [60, [0, 4, 7, 12]], [55, [0, 4, 7, 14]]], phrase: ["slowA", "slowB", "slowA", "d"], lead: "box", leadOct: 12, level: 0.68, pad: 0.8, bass: 0, arp: 0, drums: 0, heart: 0, bright: 0.25, air: 0.35 },
  rise: { chords: [[57, [0, 3, 7, 12]], [53, [0, 4, 7, 12]], [60, [0, 4, 7, 12]], [55, [0, 4, 7, 14]]], phrase: ["a", "b", "c", "d"], lead: "voice", leadOct: 0, level: 0.72, pad: 0.9, bass: 0.7, arp: 2, drums: 0, heart: 0, bright: 0.45, air: 0.25 },
  turn: { chords: [[50, [0, 3, 7, 12]], [46, [0, 4, 7, 12]], [52, [0, 4, 7, 10]], [57, [0, 3, 7, 12]]], phrase: ["frag", "fragB", "frag", "fragB"], lead: "voice", leadOct: 0, level: 0.55, pad: 1, bass: 0.8, arp: 0, drums: 0, heart: 0.9, bright: 0.18, air: 0.45, tremolo: 0.35 },
  climax: { chords: [[53, [0, 4, 7, 12]], [55, [0, 4, 7, 12]], [60, [0, 4, 7, 12]], [57, [0, 3, 7, 12]]], phrase: ["a", "b", "c", "d"], lead: "voice", leadOct: 12, harmony: true, level: 1, pad: 1, bass: 1, arp: 4, drums: 1, heart: 0, bright: 0.8, air: 0.2 },
  resolve: { chords: [[53, [0, 4, 7, 12]], [55, [0, 4, 7, 14]], [57, [0, 3, 7, 12]], [60, [0, 4, 7, 12]]], phrase: ["slowA", "slowB", "slowA", "d"], lead: "box", leadOct: 12, level: 0.6, pad: 0.8, bass: 0.4, arp: 0, drums: 0, heart: 0, bright: 0.3, air: 0.3 },
};
const TONIC = [60, [0, 4, 7, 12, 14]];

const barLen = (bpm = STORY_BPM) => (60 / bpm) * 4;

// The story's sections [{ mood, start, end }] in seconds, snapped to bars. scenes: [{ id, start, beat }]
// in cut order; arc (music.arc): [{ at: scene id | seconds, mood }] overrides the beats.
export function storyArc(scenes, duration, arc = null, bpm = STORY_BPM) {
  const bar = barLen(bpm);
  let marks;
  if (arc?.length) {
    marks = arc.map(({ at, mood }) => {
      if (!MOODS.includes(mood)) throw new Error(`music.arc: unknown mood "${mood}" (${MOODS.join(", ")})`);
      const t = typeof at === "number" ? at : scenes.find((s) => s.id === at)?.start;
      if (t === undefined) throw new Error(`music.arc: no scene "${at}" in the timeline`);
      return [mood, t];
    }).sort((a, b) => a[1] - b[1]);
  } else if (scenes.some((s) => BEAT_MOOD[s.beat])) {
    let mood = "intro";
    marks = scenes.map((s) => [(mood = BEAT_MOOD[s.beat] ?? mood), s.start]);
  } else marks = DEFAULT_ARC.map(([mood, f]) => [mood, f * duration]);
  // Snap to bars; the first section opens the track; a later mark on the same bar replaces it.
  const bars = new Map();
  for (const [mood, t] of marks) bars.set(Math.max(0, Math.round(t / bar)), mood);
  if (!bars.has(0)) bars.set(0, marks[0][0]);
  const starts = [...bars.entries()].sort((a, b) => a[0] - b[0]).filter(([b]) => b * bar < duration);
  const out = [];
  for (const [b, mood] of starts) {
    if (out.at(-1)?.mood === mood) continue;
    out.push({ mood, start: Math.round(b * bar * 1000) / 1000 });
  }
  return out.map((s, i) => ({ ...s, end: out[i + 1]?.start ?? duration }));
}

// One note of a voice added into L/R from sample s0, len seconds held.
function note(L, R, s0, f, len, voice, gain, pan) {
  const n = L.length;
  const ring = voice === "box" ? Math.max(len, 1.8) : len + 0.3;
  const total = Math.floor(ring * SR);
  for (let j = 0; j < total && s0 + j < n; j++) {
    const t = j / SR;
    let s;
    if (voice === "box") {
      // Music box: a bright partial over the fundamental, each with its own decay.
      s = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 2.2) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 6) + 0.12 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * 11);
      s *= Math.min(1, t / 0.003);
    } else {
      // A soft sung line: few harmonics, vibrato once the note settles, released after len.
      const vib = 1 + 0.004 * Math.min(1, Math.max(0, (t - 0.3) / 0.4)) * Math.sin(2 * Math.PI * 5.2 * t);
      const ph = 2 * Math.PI * f * vib * t;
      s = Math.sin(ph) + 0.25 * Math.sin(2 * ph) + 0.1 * Math.sin(3 * ph);
      s *= Math.min(1, t / 0.07) * (t < len ? 1 : Math.exp(-(t - len) / 0.1));
    }
    s *= gain;
    L[s0 + j] += s * (1 - pan);
    R[s0 + j] += s * (1 + pan);
  }
}

function kick(L, R, s0, gain, low = false) {
  const total = Math.floor(0.45 * SR);
  let ph = 0;
  for (let j = 0; j < total && s0 + j < L.length; j++) {
    const t = j / SR;
    ph += (2 * Math.PI * ((low ? 38 : 48) + 80 * Math.exp(-t * 25))) / SR;
    const s = Math.sin(ph) * Math.exp(-t * (low ? 7 : 9)) * gain;
    L[s0 + j] += s; R[s0 + j] += s;
  }
}

// Noise bursts: a snare (short, mid), a hat (very short, bright) or a crash (long, bright).
function noiseHit(L, R, s0, rand, { dur, decay, tone, gain }) {
  const total = Math.floor(dur * SR);
  let lp = 0;
  for (let j = 0; j < total && s0 + j < L.length; j++) {
    const t = j / SR;
    const w = rand() * 2 - 1;
    lp = lp * tone + w * (1 - tone);
    const s = (w - lp) * Math.exp(-t * decay) * gain * Math.min(1, t / 0.002);
    L[s0 + j] += s * (0.9 + 0.2 * rand()); R[s0 + j] += s * (0.9 + 0.2 * rand());
  }
}

// A swell into the climax: noise opening up over a rising tone, cut at the downbeat.
function riser(L, R, s0, dur, rand, gain) {
  const total = Math.floor(dur * SR);
  let ph = 0, y = 0;
  for (let j = 0; j < total && s0 + j < L.length; j++) {
    if (s0 + j < 0) continue;
    const t = j / SR, x = t / dur;
    ph += (2 * Math.PI * (220 * 2 ** (x * 2))) / SR;
    const a = Math.exp((-2 * Math.PI * (400 + 6000 * x)) / SR);
    y = (1 - a) * (rand() * 2 - 1) + a * y;
    const s = (Math.sin(ph) * 0.3 + y * 0.7) * x ** 2.2 * gain;
    L[s0 + j] += s; R[s0 + j] += s;
  }
}

export function synthStory(durationSec, { seed = 7, sections = null, bpm = STORY_BPM } = {}) {
  const secs = sections?.length ? sections : storyArc([], durationSec, null, bpm);
  for (const s of secs) if (!MOOD[s.mood]) throw new Error(`unknown story mood "${s.mood}" (${MOODS.join(", ")})`);
  const n = Math.ceil(durationSec * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const beat = 60 / bpm, bar = beat * 4;
  const rand = rng(seed);
  // Seed picks the order of the motif's middle bars, so tracks differ but always cadence on "d".
  const swap = rand() < 0.5;
  const at = (t) => secs.findLast((s) => s.start <= t + 1e-6) ?? secs[0];
  const bars = Math.ceil(durationSec / bar);
  const lastBar = Math.max(0, Math.floor((durationSec - 0.5) / bar));
  const ending = at(lastBar * bar).mood === "resolve";

  for (let b = 0; b < bars; b++) {
    const t0 = b * bar, sec = at(t0), m = MOOD[sec.mood];
    const k = Math.round((t0 - sec.start) / bar);
    const final = ending && b === lastBar;
    const [root, ivs] = final ? TONIC : m.chords[k % m.chords.length];
    const hold = final ? durationSec - t0 : bar;
    const i0 = Math.floor(t0 * SR);

    // Pad: detuned harmonic stack per chord tone, overlapping into the next bar; tremolo in the turn.
    const len = hold * 1.25;
    ivs.forEach((iv, vi) => {
      const f = NOTE(root + iv);
      const pan = (vi / (ivs.length - 1)) * 1.2 - 0.6;
      const ph = [rand() * 6.28, rand() * 6.28];
      for (let i = i0; i < Math.min(n, i0 + Math.floor(len * SR)); i++) {
        const t = (i - i0) / SR;
        const env = Math.min(1, t / (bar * 0.3)) * Math.min(1, (len - t) / (bar * 0.35));
        const trem = m.tremolo ? 1 - m.tremolo * (0.5 + 0.5 * Math.sin(2 * Math.PI * 6 * t)) : 1;
        let sL = 0, sR = 0;
        for (let h = 1; h <= 4; h++) {
          const w = (m.bright * 0.6 + 0.4) / h ** 1.6;
          sL += w * Math.sin(2 * Math.PI * f * 0.997 * h * t + ph[0] * h);
          sR += w * Math.sin(2 * Math.PI * f * 1.003 * h * t + ph[1] * h);
        }
        const g = 0.05 * m.pad * env * trem;
        L[i] += sL * g * (1 - pan * 0.5);
        R[i] += sR * g * (1 + pan * 0.5);
      }
    });

    // Bass: root two octaves down with its octave, so it reads on small speakers.
    if (m.bass) {
      const f = NOTE(root - 24);
      for (let i = i0; i < Math.min(n, i0 + Math.floor(hold * SR)); i++) {
        const t = (i - i0) / SR;
        const env = Math.min(1, t / 0.08) * Math.min(1, (hold - t) / 0.3);
        const s = (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t)) * 0.08 * m.bass * env;
        L[i] += s; R[i] += s;
      }
    }

    // Arpeggio: m.arp notes per beat, plucked, alternating sides.
    if (m.arp && !final) {
      const step = beat / m.arp;
      for (let j = 0; j < 4 * m.arp; j++) {
        const f = NOTE(root + 12 + ivs[(j * 3) % ivs.length]);
        const s0 = Math.floor((t0 + j * step) * SR);
        const vel = j % m.arp === 0 ? 1 : 0.65;
        const pan = j % 2 ? 0.35 : -0.35;
        for (let q = 0; q < Math.floor(step * 1.8 * SR) && s0 + q < n; q++) {
          const t = q / SR;
          const s = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 9) * 0.04 * vel;
          L[s0 + q] += s * (1 - pan); R[s0 + q] += s * (1 + pan);
        }
      }
    }

    // Lead: the motif bar for this place in the phrase, held on the tonic at the very end.
    let names = m.phrase;
    if (swap && names[1] !== names[2]) names = [names[0], names[2], names[1], names[3]];
    const pattern = final ? [[3, hold / beat]] : P[names[k % names.length]];
    const tones = [0, ivs[1], 7, 12, 12 + ivs[1], 19];
    let tb = t0;
    for (const [ti, beats] of pattern) {
      const dur = beats * beat;
      if (ti !== null) {
        const midi = root + m.leadOct + tones[ti];
        const gain = m.lead === "box" ? 0.07 : 0.05;
        note(L, R, Math.floor(tb * SR), NOTE(midi), dur * 0.95, m.lead, gain, 0.1);
        if (m.harmony && ti > 0) note(L, R, Math.floor(tb * SR), NOTE(root + m.leadOct + tones[ti - 1]), dur * 0.95, m.lead, gain * 0.45, -0.25);
      }
      tb += dur;
    }

    // Drums at the climax; a heartbeat (lub-dub) under the turn.
    if (m.drums && !final) {
      for (let q = 0; q < 4; q++) {
        const s0 = Math.floor((t0 + q * beat) * SR);
        if (q === 0 || q === 2) kick(L, R, s0, 0.5 * m.drums);
        if (q === 1 || q === 3) noiseHit(L, R, s0, rand, { dur: 0.25, decay: 18, tone: 0.6, gain: 0.18 * m.drums });
        for (const h of [0, 0.5]) noiseHit(L, R, Math.floor((t0 + (q + h) * beat) * SR), rand, { dur: 0.06, decay: 70, tone: 0.2, gain: (h ? 0.04 : 0.06) * m.drums });
      }
      if (b % 2) kick(L, R, Math.floor((t0 + 2.5 * beat) * SR), 0.35 * m.drums);
    }
    if (m.heart && !final) {
      kick(L, R, i0, 0.3 * m.heart, true);
      kick(L, R, Math.floor((t0 + 0.35 * beat) * SR), 0.2 * m.heart, true);
      kick(L, R, Math.floor((t0 + 2 * beat) * SR), 0.27 * m.heart, true);
      kick(L, R, Math.floor((t0 + 2.35 * beat) * SR), 0.18 * m.heart, true);
    }
  }

  // Section seams: a swell into the climax with a crash on its downbeat; a low drop into the turn.
  secs.forEach((s, i) => {
    if (!i) return;
    const s0 = Math.floor(s.start * SR);
    if (s.mood === "climax") {
      const d = Math.min(bar, s.start);
      riser(L, R, s0 - Math.floor(d * SR), d, rand, 0.12);
      noiseHit(L, R, s0, rand, { dur: 2.5, decay: 1.6, tone: 0.3, gain: 0.08 });
      kick(L, R, s0, 0.6);
    }
    if (s.mood === "turn") kick(L, R, s0, 0.45, true);
  });

  // Air bed, section loudness and brightness: both glide over a second at each seam.
  const lp = [0, 0], nz = [0, 0];
  let level = MOOD[secs[0].mood].level, bright = MOOD[secs[0].mood].bright, air = MOOD[secs[0].mood].air;
  const glide = 1 - Math.exp(-1 / (0.35 * SR));
  const fadeIn = 1.5 * SR, fadeOut = 3 * SR;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const m = MOOD[at(i / SR).mood];
    level += (m.level - level) * glide;
    bright += (m.bright - bright) * glide;
    air += (m.air - air) * glide;
    const lfo = 0.6 + 0.4 * Math.sin((2 * Math.PI * i) / (SR * 9));
    nz[0] = nz[0] * 0.88 + (rand() * 2 - 1) * 0.12;
    nz[1] = nz[1] * 0.88 + (rand() * 2 - 1) * 0.12;
    L[i] += nz[0] * 0.12 * air * lfo;
    R[i] += nz[1] * 0.12 * air * lfo;
    const a = Math.exp((-2 * Math.PI * (2500 + 7500 * bright)) / SR);
    lp[0] = (1 - a) * L[i] + a * lp[0];
    lp[1] = (1 - a) * R[i] + a * lp[1];
    const g = level * Math.min(1, i / fadeIn, (n - i) / fadeOut);
    L[i] = lp[0] * g; R[i] = lp[1] * g;
    energy += L[i] * L[i] + R[i] * R[i];
  }
  // Loudness, not the odd drum hit, sets the gain (-20 dBFS RMS over the track); a soft clip
  // rounds the transients off under 0.9 so the quiet sections are not pushed down by them.
  const rms = Math.sqrt(energy / (2 * n));
  const gain = rms ? 0.1 / rms : 1;
  for (let i = 0; i < n; i++) {
    L[i] = 0.9 * Math.tanh((L[i] * gain) / 0.9);
    R[i] = 0.9 * Math.tanh((R[i] * gain) / 0.9);
  }
  return interleave(L, R);
}

export function writeStory(path, durationSec, opts) {
  writeWav(path, synthStory(durationSec, opts));
}
