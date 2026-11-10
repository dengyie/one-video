import { test } from "node:test";
import assert from "node:assert/strict";
import { integratedLoudness, normalizeLoudness, samplePeak } from "../cli/lib/audio/loudness.mjs";

const sine = (amp, sec = 3, sr = 48000, f = 997) => Float64Array.from({ length: sec * sr }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / sr));

test("a full-scale 997 Hz sine measures about -3.01 LUFS (BS.1770 reference)", () => {
  assert.ok(Math.abs(integratedLoudness(sine(1), 48000) - -3.01) < 0.1);
});

test("loudness is sample-rate independent and honours fullScale", () => {
  const a = integratedLoudness(sine(0.25, 3, 24000), 24000);
  const b = integratedLoudness(Int16Array.from(sine(0.25 * 32768, 3, 24000), Math.round), 24000, { fullScale: 32768 });
  assert.ok(Math.abs(a - b) < 0.05);
  assert.ok(Math.abs(a - (-3.01 + 20 * Math.log10(0.25))) < 0.15);
});

test("silence is -Infinity and is returned untouched", () => {
  const z = new Float32Array(48000);
  assert.equal(integratedLoudness(z, 48000), -Infinity);
  assert.equal(normalizeLoudness(z, 48000).samples, z);
});

test("normalizeLoudness reaches the target and limits peaks under the ceiling", () => {
  const src = Int16Array.from(sine(0.1 * 32768, 3, 24000), Math.round);
  const { samples, gainDb } = normalizeLoudness(src, 24000, { target: -6, fullScale: 32768, ceilingDb: -1.5 });
  assert.ok(samples instanceof Int16Array);
  assert.ok(gainDb > 15);
  assert.ok(samplePeak(samples) <= 32768 * 10 ** (-1.5 / 20) + 1);
});
