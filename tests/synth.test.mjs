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

test("storyArc: script beats place the moods on bars, overrides win, no beats falls back to the arc", async () => {
  const { storyArc, STORY_BPM } = await import("../cli/lib/audio/story.mjs");
  const bar = (60 / STORY_BPM) * 4;
  const scenes = [
    { id: "a", start: 0, beat: "hook" }, { id: "b", start: 7.2, beat: "setup" }, { id: "c", start: 13.1, beat: "build" },
    { id: "d", start: 25.4 }, { id: "e", start: 31, beat: "turn" }, { id: "f", start: 40.6, beat: "climax" }, { id: "g", start: 52, beat: "landing" },
  ];
  const arc = storyArc(scenes, 60);
  assert.deepEqual(arc.map((s) => s.mood), ["intro", "rise", "turn", "climax", "resolve"]);
  for (const s of arc) assert.ok(Math.abs(s.start / bar - Math.round(s.start / bar)) < 1e-6, `${s.mood} at ${s.start} is off the bar`);
  assert.equal(arc[1].start, 12);
  assert.equal(arc.at(-1).end, 60);
  arc.slice(1).forEach((s, i) => assert.equal(s.start, arc[i].end));
  const over = storyArc(scenes, 60, [{ at: "a", mood: "intro" }, { at: "f", mood: "turn" }, { at: 50, mood: "resolve" }]);
  assert.deepEqual(over.map((s) => [s.mood, s.start]), [["intro", 0], ["turn", 42], ["resolve", 51]]);
  assert.throws(() => storyArc(scenes, 60, [{ at: "zz", mood: "intro" }]), /no scene "zz"/);
  assert.throws(() => storyArc(scenes, 60, [{ at: 0, mood: "sad" }]), /unknown mood/);
  assert.deepEqual(storyArc([], 60).map((s) => s.mood), ["intro", "rise", "turn", "climax", "resolve"]);
});

test("synthStory: deterministic, sized, and the climax is the loudest section, the ending quieter than the build", async () => {
  const { synthStory, storyArc } = await import("../cli/lib/audio/story.mjs");
  const sections = storyArc([], 40);
  const a = synthStory(40, { seed: 3, sections });
  assert.equal(a.channels, 2);
  assert.ok(Math.abs(a.samples.length / 2 / SR - 40) < 0.01);
  assert.deepEqual(a.samples.subarray(0, 4000), synthStory(40, { seed: 3, sections }).samples.subarray(0, 4000));
  const rms = ({ start, end }) => {
    let e = 0, k = 0;
    for (let i = Math.floor(start * SR) * 2; i < Math.floor(end * SR) * 2; i += 16) { e += a.samples[i] ** 2; k++; }
    return Math.sqrt(e / k);
  };
  const by = Object.fromEntries(sections.map((s) => [s.mood, rms(s)]));
  assert.ok(by.climax > by.rise && by.climax > by.turn && by.climax > by.intro * 2, JSON.stringify(by));
  assert.ok(by.resolve < by.rise, JSON.stringify(by));
  let peak = 0;
  for (const v of a.samples) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak < 0.9 * 32767 + 2, `peak ${peak}`);
});
