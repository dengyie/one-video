import { test } from "node:test";
import assert from "node:assert/strict";
import { alignLines, sceneSpeech, timingHashes, ttsConfig } from "../cli/lib/voice/tts.mjs";

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
