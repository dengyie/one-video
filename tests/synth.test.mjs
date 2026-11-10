import { test } from "node:test";
import assert from "node:assert/strict";
import { synthMusic, synthSfx, SFX, MUSIC_PRESETS, SR } from "../cli/lib/audio/synth.mjs";

test("synthMusic: stereo, requested length, deterministic per seed, no clipping", () => {
  for (const preset of Object.keys(MUSIC_PRESETS)) {
    const a = synthMusic(3, { preset, seed: 7 });
    assert.equal(a.channels, 2);
    assert.equal(a.sampleRate, SR);
    assert.ok(Math.abs(a.samples.length / 2 / SR - 3) < 0.01, preset);
    const b = synthMusic(3, { preset, seed: 7 });
    assert.deepEqual(a.samples.subarray(0, 2000), b.samples.subarray(0, 2000));
    let peak = 0;
    for (const v of a.samples) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 1000 && peak < 32767, `${preset} peak ${peak}`);
  }
});

test("synthSfx: every effect is short, non-silent and peak-normalized", () => {
  for (const name of Object.keys(SFX)) {
    const s = synthSfx(name);
    assert.ok(s.samples.length / 2 / s.sampleRate < 3, name);
    let peak = 0;
    for (const v of s.samples) peak = Math.max(peak, Math.abs(v));
    assert.ok(Math.abs(peak / 32767 - 0.89) < 0.02, `${name} peak ${peak}`);
  }
  assert.throws(() => synthSfx("nope"), /unknown sfx/);
});
