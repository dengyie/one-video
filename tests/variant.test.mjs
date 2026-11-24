import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sceneSpeech, timingHashes } from "../cli/lib/voice/tts.mjs";
import { ensureVariantTimings, respan, timingsFresh, variantTimings } from "../cli/lib/voice/variant.mjs";

const scene = { id: "a", narration: "SpaceX这次上市计划募资超过七百五十亿美元，将成为有史以来规模最大的一次首次公开募股。它凭什么值这么多钱？" };
const silent = { id: "b" };
const script = { scenes: [scene, silent] };
const main = { aspect: "16:9" }, tall = { aspect: "9:16" };

// The main timings as tts writes them: one scene audio, three lines on its pauses.
function mainTimings(spans = [[0, 3.1], [3.4, 6.6], [7, 8.5]]) {
  const { lines } = sceneSpeech(scene, main, {});
  const hashes = timingHashes(scene, main, {});
  return { scenes: {
    a: { file: "audio/x.wav", duration: 9, lines: lines.map((l, i) => ({ text: l.text, speak: l.speak, hash: hashes[i], start: spans[i][0], end: spans[i][1] })) },
    b: { file: null, duration: 0, lines: [] },
  } };
}

test("respan: boundaries on a main line boundary take its pause, inner ones its spoken share", () => {
  const m = [{ text: "一二三四", start: 0, end: 4 }, { text: "五六", start: 5, end: 7 }];
  assert.deepEqual(respan(m, [{ text: "一二" }, { text: "三四" }, { text: "五六" }]), [[0, 2], [2, 4], [5, 7]]);
  assert.deepEqual(respan(m, [{ text: "一二三四，五六。" }]), [[0, 7]]);
  assert.equal(respan(m, [{ text: "一二三" }]), null);
});

test("variantTimings re-spans the narrow cut on the same scene audio", () => {
  const tl = mainTimings();
  const out = variantTimings(script, tl, main, tall);
  assert.equal(out.derivedFrom, "plan/timings.json");
  const a = out.scenes.a;
  assert.equal(a.file, "audio/x.wav");
  assert.equal(a.duration, 9);
  assert.deepEqual(a.lines.map((l) => l.hash), timingHashes(scene, tall, {}));
  assert.equal(a.lines.length, 5);
  // The narrow lines split the main ones: their outer ends are the main pauses.
  assert.deepEqual([a.lines[0].start, a.lines[1].end, a.lines[2].start, a.lines[3].end, a.lines[4].start, a.lines[4].end], [0, 3.1, 3.4, 6.6, 7, 8.5]);
  assert.ok(a.lines[0].end > 0 && a.lines[0].end < 3.1 && a.lines[1].start === a.lines[0].end);
  for (const l of a.lines) assert.ok(l.end >= l.start);
  assert.ok(timingsFresh(script, out, tall));
  assert.equal(timingsFresh(script, tl, tall), false);
  assert.deepEqual(out.scenes.b, tl.scenes.b);
});

test("variantTimings gives up when the variant speaks other audio or the main misses a scene", () => {
  const tl = mainTimings();
  assert.equal(variantTimings(script, tl, main, { ...tall, tts: { unit: "line" } }), null);
  assert.equal(variantTimings(script, { scenes: {} }, main, tall), null);
  // Another lexicon changes what is spoken: the scene audio differs.
  assert.equal(variantTimings(script, tl, main, { ...tall, lexicon: { SpaceX: "太空探索" } }), null);
});

test("updated caption boundaries cannot reuse stale text with the same scene audio hash and line count", () => {
  const s = { id: "c", narration: "这个数是国际单位制直接定义的。" };
  const config = { aspect: "9:16" };
  const hashes = timingHashes(s, config, {});
  const old = { scenes: { c: { file: "audio/c.wav", duration: 3, lines: [
    { text: "这个数是国际单位制直接定义", start: 0, end: 2, hash: hashes[0] },
    { text: "的", start: 2, end: 3, hash: hashes[1] },
  ] } } };
  const script = { scenes: [s] };
  assert.equal(timingsFresh(script, old, config), false);
  const updated = variantTimings(script, old, config, config);
  assert.ok(timingsFresh(script, updated, config));
  assert.equal(updated.scenes.c.file, "audio/c.wav");
  assert.equal(updated.scenes.c.lines[1].text, "直接定义的");
});

test("ensureVariantTimings derives the variant's timings from fresh main ones without audio or key", async () => {
  // No variant audio is cached under linesDir, so a key is never asked for on this path.
  const root = mkdtempSync(join(tmpdir(), "ov-variant-"));
  mkdirSync(join(root, "plan"));
  const paths = { script: join(root, "plan", "script.json"), timings: join(root, "plan", "timings.9x16.json"), linesDir: join(root, "public", "audio", "9x16", "lines") };
  writeFileSync(paths.script, JSON.stringify(script));
  writeFileSync(join(root, "plan", "timings.json"), JSON.stringify(mainTimings()));
  const project = { root, aspect: "9:16", config: tall, paths, main: { config: main, timings: join(root, "plan", "timings.json") } };
  const saved = process.env.MANGO_API_KEY;
  delete process.env.MANGO_API_KEY;
  try {
    const out = await ensureVariantTimings(project);
    assert.equal(out.derivedFrom, "plan/timings.json");
    assert.ok(existsSync(paths.timings));
    assert.deepEqual(JSON.parse(readFileSync(paths.timings, "utf8")), out);
    // Fresh derived timings are kept while the audio is still not cached.
    assert.deepEqual(await ensureVariantTimings(project), out);
  } finally {
    if (saved !== undefined) process.env.MANGO_API_KEY = saved;
  }
});
