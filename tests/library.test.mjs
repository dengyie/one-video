import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processSfx, resolveSfx, mergeCatalogs, searchCatalog, verifyCatalog, loadCatalog } from "../cli/lib/library/catalog.mjs";
import { integratedLoudness } from "../cli/lib/audio/loudness.mjs";
import { transitionSfx, sfxFile, AUTO_TRANSITION_SFX } from "../cli/lib/timeline/index.mjs";

const tone = (sec, amp, { lead = 0, sr = 48000 } = {}) => {
  const n = Math.round(sec * sr), l = Math.round(lead * sr), s = new Int16Array((n + l) * 2);
  for (let i = 0; i < n; i++) { const v = Math.round(amp * 32767 * Math.sin((2 * Math.PI * 1000 * i) / sr)); s[(l + i) * 2] = v; s[(l + i) * 2 + 1] = v; }
  return { samples: s, sampleRate: sr, channels: 2 };
};
const monoOf = (w) => { const m = new Float32Array(w.samples.length / 2); for (let i = 0; i < m.length; i++) m[i] = (w.samples[2 * i] + w.samples[2 * i + 1]) / 2; return m; };

test("processSfx trims leading silence, caps length with a fade, hits the loudness target", () => {
  const res = processSfx(tone(5, 0.05, { lead: 0.5 }), { maxDuration: 2 });
  assert.ok(Math.abs(res.duration - 2.005) < 0.01);
  const lufs = integratedLoudness(monoOf(res.wav), 48000, { fullScale: 32768 });
  assert.ok(Math.abs(lufs - -20) < 0.6, `lufs ${lufs}`);
  assert.ok(res.peakDb <= -1.4);
  assert.equal(res.wav.samples.at(-1), 0);
  // Sub-400 ms clicks are measured as one block, so they normalize too.
  const click = processSfx(tone(0.05, 0.02));
  assert.ok(Number.isFinite(click.measured) && click.peakDb > -20);
  assert.throws(() => processSfx(tone(0, 0, { lead: 1 })), /silent/);
});

test("resolveSfx: id, category default, fallback when the default is on another host", () => {
  const root = mkdtempSync(join(tmpdir(), "ov-lib-"));
  process.env.ONEVIDEO_LIBRARY_EXT = root;
  mkdirSync(join(root, "sfx"), { recursive: true });
  writeFileSync(join(root, "sfx", "b.wav"), "x");
  const catalog = { defaults: { hit: "hit-01" }, entries: [
    { id: "hit-01", category: "hit", store: "ext", file: "sfx/a.wav" },
    { id: "hit-02", category: "hit", store: "ext", file: "sfx/b.wav", note: "Heavy door" },
  ] };
  assert.deepEqual(resolveSfx("hit", catalog), { entry: catalog.entries[1], fallback: true });
  assert.equal(resolveSfx("hit-01", catalog), null);
  assert.equal(resolveSfx("hit-02", catalog).fallback, false);
  assert.equal(resolveSfx("nope", catalog), null);
  writeFileSync(join(root, "sfx", "a.wav"), "x");
  assert.equal(resolveSfx("hit", catalog).entry.id, "hit-01");
  assert.deepEqual(searchCatalog("heavy hit", catalog).map((e) => e.id), ["hit-02"]);
  assert.deepEqual(verifyCatalog({ entries: [{ id: "x", store: "ext", file: "sfx/zz.wav" }, { id: "y", store: "repo", file: "sfx/none/zz.wav" }] }).map((r) => r.status), ["unavailable", "missing"]);
  delete process.env.ONEVIDEO_LIBRARY_EXT;
});

test("mergeCatalogs: union by id, incoming wins, local defaults kept", () => {
  const m = mergeCatalogs({ defaults: { a: "a-01" }, entries: [{ id: "a-01", v: 1 }] }, { defaults: { a: "a-02", b: "b-01" }, entries: [{ id: "a-01", v: 2 }, { id: "b-01" }] });
  assert.deepEqual(m.defaults, { a: "a-01", b: "b-01" });
  assert.deepEqual(m.entries.map((e) => e.v ?? 0), [2, 0]);
});

test("committed catalog: every repo entry exists and matches its hash", () => {
  const res = verifyCatalog(loadCatalog());
  assert.ok(res.length > 0);
  assert.deepEqual(res.filter((r) => r.status === "missing" || r.status === "mismatch"), []);
});

test("transition sfx: auto map, per-type map, synth: names map to safe files", () => {
  assert.equal(transitionSfx("auto", "whip"), AUTO_TRANSITION_SFX.whip);
  assert.equal(transitionSfx("auto", "fade"), null);
  assert.equal(transitionSfx("auto", "cut"), null);
  assert.equal(sfxFile("synth:tick"), "sfx/synth-tick.wav");
  assert.equal(sfxFile("impact-02"), "sfx/impact-02.wav");
});

test("cutClip trims a video window to silent ≤1080p H.264", async () => {
  const { cutClip } = await import("../cli/lib/assets/index.mjs");
  const { ffmpeg, ffprobe } = await import("../cli/lib/core/ffmpeg.mjs");
  const dir = mkdtempSync(join(tmpdir(), "ov-clip-"));
  const src = join(dir, "src.mp4"), out = join(dir, "out.mp4");
  await ffmpeg(["-y", "-f", "lavfi", "-i", "nullsrc=size=2560x1440:rate=25:duration=4", "-f", "lavfi", "-i", "sine=duration=4", "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", src]);
  const res = await cutClip(src, out, [1, 2]);
  assert.deepEqual([res.width, res.height], [1920, 1080]);
  assert.ok(Math.abs(res.duration - 2) < 0.15, `duration ${res.duration}`);
  const streams = (await ffprobe(out)).streams;
  assert.equal(streams.filter((s) => s.codec_type === "audio").length, 0);
  assert.equal(streams.find((s) => s.codec_type === "video").codec_name, "h264");
});

test("clipFrames extracts a 30fps JPEG sequence the timeline can count", async () => {
  const { cutClip, clipFrames, countFrames, framesDir } = await import("../cli/lib/assets/index.mjs");
  const { ffmpeg } = await import("../cli/lib/core/ffmpeg.mjs");
  const dir = mkdtempSync(join(tmpdir(), "ov-frames-"));
  const src = join(dir, "src.mp4"), out = join(dir, "clip.mp4"), seq = join(dir, framesDir("clip.mp4"));
  assert.equal(framesDir("assets/x.MP4"), "assets/x.frames");
  assert.equal(countFrames(seq), 0);
  await ffmpeg(["-y", "-f", "lavfi", "-i", "nullsrc=size=640x360:rate=25:duration=3", "-c:v", "libx264", "-preset", "ultrafast", src]);
  await cutClip(src, out, [0, 2]);
  const n = await clipFrames(out, seq);
  assert.ok(Math.abs(n - 60) <= 1, `frames ${n}`);
  assert.equal(countFrames(seq), n);
  assert.equal(await clipFrames(out, seq), n, "re-extraction replaces the old sequence");
});

test("recipes: every recipe fills to a valid storyboard", async () => {
  const { loadRecipes, fillRecipe, recipeSlots } = await import("../cli/lib/library/catalog.mjs");
  const { schemaGate } = await import("../cli/lib/review/gates.mjs");
  const recipes = loadRecipes();
  assert.ok(recipes.length >= 10);
  for (const r of recipes) {
    assert.ok(r.name && r.title && r.description, `${r.name}: name/title/description`);
    const vars = Object.fromEntries(recipeSlots(r).map((k) => [k, k === "corners" ? "[[0.4,0.2],[0.6,0.2],[0.6,0.8],[0.4,0.8]]" : "a"]));
    const { scenes, missing } = fillRecipe(r, { id: "x", vars });
    assert.deepEqual(missing, []);
    assert.equal(scenes[0].id, "x");
    assert.deepEqual(schemaGate("storyboard", { scenes }), [], r.name);
  }
  const { missing } = fillRecipe(recipes[0], {});
  assert.ok(missing.length > 0);
});
