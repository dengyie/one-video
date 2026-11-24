import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alignLines, lineHash, runTts, sceneSpeech, timingHashes, ttsConfig } from "../cli/lib/voice/tts.mjs";
import { findPauses, readWav, toMono, writeWav } from "../cli/lib/audio/wav.mjs";

test("cached TTS shortens dead air before measuring narration and aligning captions", async () => {
  const root = mkdtempSync(join(tmpdir(), "ov-pause-"));
  try {
    const paths = { linesDir: join(root, "lines"), audioDir: join(root, "audio") };
    mkdirSync(paths.linesDir);
    const config = { tts: { loudness: false } };
    const t = ttsConfig(config);
    const scene = { id: "cta", lines: [{ text: "Open the link" }, { text: "Watch it now" }] };
    const samples = Int16Array.from({ length: t.sampleRate * 4 }, (_, i) => Math.round(8000 * Math.sin(i * 2 * Math.PI * 440 / t.sampleRate)));
    samples.fill(0, t.sampleRate * 0.4, t.sampleRate * 0.7);
    samples.fill(0, t.sampleRate, t.sampleRate * 2.2);
    const cache = join(paths.linesDir, `${lineHash(sceneSpeech(scene, config, {}).speak, t)}.wav`);
    writeWav(cache, { samples, sampleRate: t.sampleRate, channels: 1 });
    const result = await runTts({ root, config, paths }, { scenes: [scene] }, { cachedOnly: true });
    const { duration, lines } = result.scenes.cta;
    assert.equal(duration, 3.8);
    assert.equal(Math.round((lines[1].start - lines[0].end) * 100), 50);
    const gaps = findPauses(toMono(readWav(join(paths.audioDir, "cta.wav")), t.sampleRate), t.sampleRate);
    assert.deepEqual(gaps.slice(1).map(([a, b]) => Math.round((b - a) * 100)), [30, 50]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("alignLines snaps line boundaries to the pauses nearest their syllable share", () => {
  // Three equal lines over 9 s; pauses near 3 s and 6 s, plus a distracting short one at 4.5 s.
  const spans = alignLines([10, 10, 10], 9, [[2.8, 3.2], [4.5, 4.6], [6.1, 6.5]], ["clause", "sentence", "sentence"]);
  assert.deepEqual(spans, [[0, 2.8], [3.2, 6.1], [6.5, 9]]);
});

test("alignLines prefers the longer pause after a full sentence", () => {
  const spans = alignLines([10, 10], 6, [[2.95, 3.05], [3.2, 3.7]], ["sentence", "sentence"]);
  assert.deepEqual(spans, [[0, 3.2], [3.7, 6]]);
});

test("alignLines falls back to the syllable estimate when no pause is near", () => {
  const spans = alignLines([1, 3], 8, []);
  assert.deepEqual(spans, [[0, 2], [2, 8]]);
});

test("alignLines keeps boundaries in time order when a pause sits past the next estimate", () => {
  // Snapping the first boundary to the 5.5–6.0 pause would leave the second (estimated at 5.1 s) behind it.
  const spans = alignLines([50, 1, 49], 10, [[5.5, 6.0]], ["sentence", "clause"]);
  assert.deepEqual(spans, [[0, 5], [5, 5.5], [6, 10]]);
  for (let k = 1; k < spans.length; k++) assert.ok(spans[k][0] >= spans[k - 1][1]);
});

test("sceneSpeech speaks the narration with its own punctuation", () => {
  const config = { aspect: "16:9" };
  const { lines, speak } = sceneSpeech({ id: "a", narration: "凭什么值一万多亿美元？上涨约19%。" }, config, {});
  assert.equal(lines.length, 2);
  assert.equal(speak, "凭什么值一万多亿美元？上涨约百分之19。");
  const explicit = sceneSpeech({ id: "b", lines: [{ text: "第一句", pause: "clause" }, "第二句"] }, config, {});
  assert.equal(explicit.speak, "第一句，第二句。");
});

test("scene unit gives every line the scene audio hash; line unit hashes each line", () => {
  const scene = { id: "a", narration: "第一句话。第二句话。" };
  const scened = timingHashes(scene, { aspect: "16:9" }, {});
  assert.equal(scened.length, 2);
  assert.equal(scened[0].split(".")[0], scened[1].split(".")[0]);
  const lined = timingHashes(scene, { aspect: "16:9", tts: { unit: "line" } }, {});
  assert.notEqual(lined[0], lined[1]);
  assert.equal(ttsConfig({}).protocol, "chat");
});

test("designed voice: clone model, voice named by the description, reference clip as a data URL", async () => {
  const { chatRequest, voiceRef, designFile } = await import("../cli/lib/voice/tts.mjs");
  const { mkdtempSync, writeFileSync: write } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join: pjoin } = await import("node:path");
  const base = { aspect: "16:9", tts: { style: "讲故事" } };
  const a = ttsConfig({ ...base, tts: { ...base.tts, design: "六十多岁的老渔夫，嗓音低沉" } });
  const b = ttsConfig({ ...base, tts: { ...base.tts, design: "四十岁的女性，声音柔和" } });
  assert.equal(a.model, "mimo-v2.5-tts-voiceclone");
  assert.match(a.voice, /^design:[0-9a-f]{12}$/);
  assert.notEqual(a.voice, b.voice);
  const scene = { id: "s", narration: "一句话。" };
  assert.notEqual(timingHashes(scene, { ...base, tts: a }, {})[0], timingHashes(scene, { ...base, tts: b }, {})[0]);
  assert.notEqual(timingHashes(scene, base, {})[0], timingHashes(scene, { ...base, tts: { ...base.tts, design: "六十多岁的老渔夫，嗓音低沉" } }, {})[0]);
  assert.throws(() => ttsConfig({ tts: { design: "老渔夫的声音", ref: "v.wav" } }), /either design/);
  assert.throws(() => ttsConfig({ tts: { design: "老渔夫的声音", protocol: "speech" } }), /protocol chat/);
  // The design call carries the description as the user turn and no voice; clone calls carry the clip.
  const design = chatRequest(a.designText, { ...a, model: a.designModel, style: a.design, design: true });
  assert.equal(design.model, "mimo-v2.5-tts-voicedesign");
  assert.equal(design.messages[0].content, a.design);
  assert.equal(design.audio.voice, undefined);
  const clone = chatRequest("一句话。", { ...a, refData: "data:audio/wav;base64,UklGRg==" });
  assert.equal(clone.audio.voice, "data:audio/wav;base64,UklGRg==");
  assert.deepEqual(clone.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(chatRequest("x", ttsConfig({})).audio.voice, "mimo_default");
  // A cached design clip (or a ref recording) is read without any request.
  const dir = mkdtempSync(pjoin(tmpdir(), "ov-voice-"));
  write(designFile(a, dir), Buffer.from("RIFF0000WAVE"));
  assert.equal(await voiceRef(a, { root: dir, linesDir: dir }, null), `data:audio/wav;base64,${Buffer.from("RIFF0000WAVE").toString("base64")}`);
  write(pjoin(dir, "me.wav"), Buffer.from("RIFFxxxxWAVE"));
  const r = ttsConfig({ tts: { ref: "me.wav" } });
  assert.equal(r.voice, "ref:me.wav");
  assert.match(await voiceRef(r, { root: dir, linesDir: dir }, null), /^data:audio\/wav;base64,/);
  await assert.rejects(voiceRef(ttsConfig({ tts: { ref: "none.wav" } }), { root: dir, linesDir: dir }, null), /no file/);
});

test("tts --audition takes: a |-list wins over tts.auditions, objects keep their style, bounded", async () => {
  const { auditionTakes } = await import("../cli/commands/media.mjs");
  assert.deepEqual(auditionTakes("温暖低沉的男声| 清亮的年轻女声 |", {}), [{ design: "温暖低沉的男声" }, { design: "清亮的年轻女声" }]);
  assert.deepEqual(auditionTakes(true, { tts: { auditions: ["沙哑的老渔夫嗓音", { design: "温柔女声，像睡前故事", style: "语速自然偏快" }] } }), [
    { design: "沙哑的老渔夫嗓音" },
    { design: "温柔女声，像睡前故事", style: "语速自然偏快" },
  ]);
  assert.throws(() => auditionTakes(true, {}), /give voice descriptions/);
  assert.throws(() => auditionTakes("a1234|b1234|c1234|d1234|e1234|f1234|g1234", {}), /at most 6/);
});

test("timeStretch changes the pace, not the pitch", async () => {
  const { timeStretch } = await import("../cli/lib/audio/wav.mjs");
  const sr = 24000;
  const tone = new Float32Array(sr * 2).map((_, i) => 8000 * Math.sin((2 * Math.PI * 220 * i) / sr));
  const crossings = (x) => { let n = 0; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) n++; return n / (x.length / sr); };
  for (const f of [1.25, 0.85]) {
    const out = timeStretch(tone, sr, f);
    assert.equal(out.length, Math.round(tone.length / f));
    assert.ok(Math.abs(crossings(out.subarray(1000, out.length - 1000)) - 220) < 3, `pitch kept at ×${f}`);
    let peak = 0;
    for (let i = 1000; i < out.length - 1000; i++) peak = Math.max(peak, Math.abs(out[i]));
    assert.ok(peak > 7000 && peak < 9000, `level kept at ×${f} (${peak})`);
  }
  assert.equal(timeStretch(tone, sr, 1), tone);
});

test("tts.tempo: auto lands a slow voice in the band, retimes the captions, keeps the synthesis cache", async () => {
  const { autoTempo, lineHash } = await import("../cli/lib/voice/tts.mjs");
  assert.equal(autoTempo([4.5, 5]), 1);
  assert.equal(autoTempo([3.1]), 1.17);
  // The slowest scene decides, even when the film on average is inside the band.
  assert.equal(autoTempo([3.3, 3.5, 4.4, 4.6]), 1.1);
  // …but never pushes the fastest scene past the ceiling.
  assert.equal(autoTempo([3.0, 5.8]), 1.04);
  assert.equal(autoTempo([2.1]), 1.35); // capped: a voice that slow needs another speaker
  assert.equal(autoTempo([7.5]), 0.85);
  assert.ok(autoTempo([3.1], [4, 6]) > 1.3);

  const scene = { id: "a", narration: "海边有一座灯塔。每天夜里，它只亮一盏灯。" };
  const base = { aspect: "16:9", tts: { design: "三十多岁的男性，嗓音偏低" } };
  const plain = timingHashes(scene, base, {});
  const auto = timingHashes(scene, { ...base, tts: { ...base.tts, tempo: "auto" } }, {});
  const fixed = timingHashes(scene, { ...base, tts: { ...base.tts, tempo: 1.2 } }, {});
  assert.notEqual(auto[0], plain[0]);
  assert.notEqual(fixed[0], auto[0]);
  // The synthesized clip is named by the voice and text alone: changing the tempo costs no API call.
  const split = (h) => h.split(".")[0].split("~")[0];
  assert.equal(split(auto[0]), split(plain[0]));
  assert.equal(split(fixed[0]), lineHash(sceneSpeech(scene, base, {}).speak, ttsConfig(base)));
  assert.equal(auto[0].split(".").length, 2, "the scene-audio hash stays one dot-free token");
  assert.throws(() => ttsConfig({ tts: { tempo: 2 } }), /tts.tempo/);
  assert.throws(() => ttsConfig({ tts: { tempo: "fast" } }), /tts.tempo/);
});
