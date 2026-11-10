// ITU-R BS.1770 integrated loudness (mono) and a narration normalizer, so the
// mix lands near the QC target without relying on ffmpeg filters at render time.

// K-weighting = high-shelf pre-filter + RLB high-pass; coefficients derived for any sample rate.
function kWeightCoeffs(fs) {
  const shelf = (() => {
    const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / fs), Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
    const a0 = 1 + K / Q + K * K;
    return { b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  })();
  const hp = (() => {
    const f0 = 38.13547087602444, Q = 0.5003270373238773;
    const K = Math.tan((Math.PI * f0) / fs), a0 = 1 + K / Q + K * K;
    return { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  })();
  return [shelf, hp];
}

function biquad(x, { b, a }) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// Integrated loudness in LUFS of mono samples (full scale `fullScale`, 32768 for int16 values); -Infinity for silence.
// Measured as a single channel (as ffmpeg loudnorm does); a Remotion render of mono narration
// measures within ~0.5 LU of this, so no dual-mono +3 dB is added by default.
export function integratedLoudness(samples, sampleRate, { dualMono = false, fullScale = 1 } = {}) {
  const [shelf, hp] = kWeightCoeffs(sampleRate);
  const k = biquad(biquad(samples, shelf), hp);
  const block = Math.round(0.4 * sampleRate), hop = Math.round(0.1 * sampleRate);
  const powers = [];
  for (let s = 0; s + block <= k.length; s += hop) {
    let p = 0;
    for (let i = s; i < s + block; i++) p += k[i] * k[i];
    powers.push(p / block);
  }
  // Clips shorter than one 400 ms block (clicks, pops) are measured as a single block.
  if (!powers.length && k.length) powers.push(k.reduce((a, v) => a + v * v, 0) / k.length);
  const lufs = (p) => -0.691 + 10 * Math.log10(p / (fullScale * fullScale)) + (dualMono ? 10 * Math.log10(2) : 0);
  const mean = (ps) => ps.reduce((a, b) => a + b, 0) / ps.length;
  const abs = powers.filter((p) => lufs(p) > -70);
  if (!abs.length) return -Infinity;
  const rel = lufs(mean(abs)) - 10;
  const gated = abs.filter((p) => lufs(p) > rel);
  return lufs(mean(gated.length ? gated : abs));
}

export function samplePeak(samples) {
  let m = 0;
  for (const v of samples) if (Math.abs(v) > m) m = Math.abs(v);
  return m;
}

// Gain toward a loudness target, then soft-limit peaks under `ceilingDb` (tanh knee).
export function normalizeLoudness(samples, sampleRate, { target = -16, ceilingDb = -1.5, kneeDb = 4, measuredOverride, fullScale = 1 } = {}) {
  // measuredOverride: apply a gain computed over a larger whole (e.g. all scenes together).
  const measured = measuredOverride ?? integratedLoudness(samples, sampleRate, { fullScale });
  if (!Number.isFinite(measured)) return { samples, gainDb: 0, measured, limited: 0 };
  const gainDb = target - measured;
  const g = 10 ** (gainDb / 20);
  const c = fullScale * 10 ** (ceilingDb / 20), t = fullScale * 10 ** ((ceilingDb - kneeDb) / 20);
  // Same array type as the input; integer arrays (Int16Array for WAV) get rounded values.
  const out = new samples.constructor(samples.length);
  const q = out instanceof Float32Array || out instanceof Float64Array ? (x) => x : Math.round;
  let limited = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] * g, a = Math.abs(v);
    if (a <= t) out[i] = q(v);
    else { out[i] = q(Math.sign(v) * (t + (c - t) * Math.tanh((a - t) / (c - t)))); limited++; }
  }
  return { samples: out, gainDb, measured, limited: limited / samples.length };
}
