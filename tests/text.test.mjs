import { test } from "node:test";
import assert from "node:assert/strict";
import { visualLength, spokenLength, speakable, extractNumbers, normalizeForMatch } from "../cli/lib/core/text.mjs";
import { splitLines } from "../cli/lib/captions/index.mjs";

test("visualLength counts CJK as 1 and ASCII as 0.55", () => {
  assert.equal(visualLength("市值"), 2);
  assert.equal(visualLength("ab"), 1.1);
});

test("spokenLength weighs digits above Han characters and ignores punctuation", () => {
  assert.equal(spokenLength("，。！"), 0);
  assert.equal(spokenLength("约"), 1);
  assert.ok(Math.abs(spokenLength("2024年") - (4 * 1.6 + 1)) < 1e-9);
  assert.ok(Math.abs(spokenLength("IPO") - 1.8) < 1e-9);
});

test("splitLines keeps lines within maxChars and marks sentence/clause pauses", () => {
  const lines = splitLines("发行价135美元，募资约857亿美元，是史上规模最大的IPO。首日收盘上涨约19%。", 14);
  for (const l of lines) assert.ok(visualLength(l.text) <= 14, l.text);
  assert.equal(lines.at(-1).pause, "sentence");
  assert.ok(lines.some((l) => l.pause === "clause"));
  assert.ok(lines.every((l) => !/[，。]$/.test(l.text)));
});

test("splitLines never cuts inside a number or Latin word", () => {
  const lines = splitLines("当年的市值约1234567亿而SpaceX排第七名", 8);
  assert.ok(lines.length > 1);
  assert.ok(lines.some((l) => l.text.includes("1234567")));
  assert.ok(lines.some((l) => l.text.includes("SpaceX")));
});

test("speakable applies lexicon (longest first) and built-in rules", () => {
  assert.equal(speakable("SPCX涨了19%", { SPCX: "S P C X", SP: "错" }), "S P C X涨了百分之19");
  assert.equal(speakable("3~5年"), "3到5年");
  assert.equal(speakable("3 - 5年"), "3到5年");
  assert.equal(speakable("2024-06发布"), "2024-06发布", "a date is not a range");
  assert.equal(speakable("气温-3度到-5度"), "气温-3度到-5度", "negatives keep their sign");
});

test("extractNumbers returns numbers with Chinese units", () => {
  assert.deepEqual(extractNumbers("约1.25万亿美元，36年后，排第7"), ["1.25万亿", "36年", "7"]);
});

test("normalizeForMatch strips punctuation and spaces", () => {
  assert.equal(normalizeForMatch("而 SpaceX，排在“第7”。"), "而SpaceX排在第7");
});
