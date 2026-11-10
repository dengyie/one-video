import { test } from "node:test";
import assert from "node:assert/strict";
import { schemaGate, numbersGate, captionGate, storyboardGate, rateGate, assetsGate, budgetGate, timingsGate, normalizeLicense, summarize, questionGate, echoGate } from "../cli/lib/gates.mjs";
import { compileTimeline } from "../cli/lib/timeline.mjs";
import { example } from "./helpers.mjs";

const msgs = (issues, gate) => issues.filter((i) => !gate || i.gate === gate).map((i) => i.msg);

test("the SpaceX example passes every pre-compose gate", () => {
  const ex = example();
  const issues = [
    ...schemaGate("project", ex.config), ...schemaGate("research", ex.research), ...schemaGate("script", ex.script), ...schemaGate("storyboard", ex.storyboard),
    ...numbersGate(ex.script, ex.research), ...captionGate(ex.script, ex.config), ...budgetGate(ex.script, ex.config),
    ...storyboardGate(ex.storyboard, ex.script, ex.config, null), ...rateGate(ex.script, ex.timings, ex.config),
  ];
  assert.deepEqual(summarize(issues).errors, []);
  assert.deepEqual(msgs(issues, "rate"), []);
});

test("numbersGate rejects unsourced numbers and dangling claim ids", () => {
  const research = { facts: [{ id: "a", claim: "收入约187亿美元", source: { title: "t" } }], allowNumbers: ["36年"] };
  const script = { scenes: [{ id: "s", narration: "收入约187亿美元，36年后增长到999亿。", claims: ["a", "zzz"] }] };
  const m = msgs(numbersGate(script, research));
  assert.ok(m.some((x) => /"999亿"/.test(x)));
  assert.ok(!m.some((x) => /187|36/.test(x)));
  assert.ok(m.some((x) => /claim "zzz"/.test(x)));
});

test("numbersGate requires a source on every fact", () => {
  assert.ok(msgs(numbersGate({ scenes: [] }, { facts: [{ id: "x", claim: "c" }] })).some((x) => /no source/.test(x)));
});

test("schemaGate validates storyboard props per scene type", () => {
  const sb = { scenes: [{ id: "a", type: "bar-race", props: { periods: "1990" } }] };
  assert.ok(schemaGate("storyboard", sb).length > 0);
});

test("storyboardGate: periodCues must reference defined cues", () => {
  const ex = example();
  const sb = structuredClone(ex.storyboard);
  sb.scenes.find((s) => s.id === "race").props.periodCues = ["y1990", "nope", null, "y2026"];
  assert.ok(msgs(storyboardGate(sb, ex.script, ex.config, null), "cues").some((x) => /"nope"/.test(x)));
});

test("rateGate flags speech outside the syllables/s band", () => {
  const timings = { scenes: { s: { lines: [{ text: "一二三四五六七八九十", start: 0, end: 0.5 }] } } };
  assert.ok(msgs(rateGate({ scenes: [{ id: "s" }] }, timings, {})).some((x) => /syllables\/s/.test(x)));
});

test("budgetGate errors when narration is far from targetSeconds", () => {
  const script = { scenes: [{ id: "s", narration: "很短。" }] };
  assert.equal(budgetGate(script, { targetSeconds: 120 })[0].level, "error");
  assert.deepEqual(budgetGate(script, {}), []);
});

test("normalizeLicense is an allowlist", () => {
  assert.equal(normalizeLicense("PD (NASA)"), "pd");
  assert.equal(normalizeLicense("CC BY-SA 4.0"), "cc-by-sa");
  assert.equal(normalizeLicense("CC BY 2.0"), "cc-by");
  assert.equal(normalizeLicense("CC BY-NC 4.0"), null);
  assert.equal(normalizeLicense("All rights reserved"), null);
});

test("assetsGate requires attribution for CC BY and blocks unknown licenses", () => {
  const issues = assetsGate({ items: [
    { id: "a", file: "assets/a.jpg", license: "CC BY 4.0" },
    { id: "b", file: "assets/b.jpg", license: "Editorial use only" },
    { id: "c", license: "CC0", width: 640, height: 480 },
  ] });
  const m = msgs(issues);
  assert.ok(m.some((x) => /"a".*author and source/.test(x)));
  assert.ok(m.some((x) => /"b".*allowlist/.test(x)));
  assert.ok(m.some((x) => /"c" not fetched/.test(x)));
  assert.ok(m.some((x) => /"c" is 640x480/.test(x)));
});

test("assetsGate flags a still standing in for a failed clip, not as duplicate media", () => {
  const m = msgs(assetsGate({ items: [
    { id: "pad", file: "assets/pad.png", license: "generated", source: "generated" },
    { id: "liftoff", file: "assets/pad.png", kind: "image", license: "generated", source: "generated", fallback: { from: "pad", reason: "HTTP 429" } },
  ] }));
  assert.ok(m.some((x) => /"liftoff" is still "pad".*HTTP 429.*--only liftoff/.test(x)));
  assert.ok(!m.some((x) => /same source media/.test(x)));
});

test("numbersGate matches whole number tokens, not substrings of fact numbers", () => {
  const research = { facts: [
    { id: "y", claim: "2025年营收翻倍", source: { title: "t" } },
    { id: "v", claim: "估值约 1.85万亿美元，员工 1,000 人", source: { title: "t" } },
    { id: "p", claim: "募资", value: 85.7e9, unit: "USD", source: { title: "t" } },
  ] };
  const bad = (narration) => msgs(numbersGate({ scenes: [{ id: "s", narration }] }, research));
  assert.ok(bad("规模达到 25 万亿。").some((x) => /"25万亿"/.test(x)), "25万亿 is not sourced by 2025年");
  assert.ok(bad("增长 202%。").some((x) => /"202%"/.test(x)));
  assert.deepEqual(bad("2025年，估值约1.85万亿。"), []);
  assert.ok(bad("估值约1.8万亿。").some((x) => /"1.8万亿"/.test(x)));
  assert.ok(bad("估值约1.85亿。").some((x) => /"1.85亿"/.test(x)), "units must agree");
  assert.deepEqual(bad("员工1000人。"), [], "1,000 equals 1000");
  assert.deepEqual(bad("募资857亿美元。"), [], "magnitude matches a numeric fact value");
  assert.ok(bad("规模5万亿。").some((x) => /"5万亿"/.test(x)), "a single digit with a magnitude unit is a claim");
  assert.deepEqual(bad("3 个原因。"), []);
});

test("timingsGate flags narration changed since tts", () => {
  const ex = example();
  assert.deepEqual(timingsGate(ex.script, ex.timings, ex.config), []);
  const script = structuredClone(ex.script);
  const s = script.scenes.find((x) => x.narration);
  s.narration = s.narration.replace(/。/, "，而且现在改了。");
  assert.ok(msgs(timingsGate(script, ex.timings, ex.config)).some((x) => x.includes(`scene "${s.id}"`) && /run: onevideo tts/.test(x)));
  const voice = { ...ex.config, tts: { voice: "other" } };
  assert.ok(timingsGate(ex.script, ex.timings, voice).length > 0, "a voice change invalidates timings");
  const style = { ...ex.config, tts: { ...ex.config.tts, style: "另一种语气" } };
  assert.ok(timingsGate(ex.script, ex.timings, style).length > 0, "a style change invalidates timings");
  const split = { ...ex.config, captions: { ...ex.config.captions, maxChars: 10 } };
  assert.ok(timingsGate(ex.script, ex.timings, split).length > 0, "a new caption split re-aligns the lines");
});

test("questionGate lists narrated scenes that answer no audience question", () => {
  const script = { scenes: [{ id: "a", narration: "x", question: "为什么？" }, { id: "b", narration: "y" }, { id: "c", lines: ["z"], question: " " }, { id: "credits", beat: "credits" }] };
  const out = questionGate(script);
  assert.equal(out.length, 1);
  assert.equal(out[0].level, "warn");
  assert.match(out[0].msg, /: b, c —/);
  assert.deepEqual(questionGate(example().script), []);
});

test("echoGate flags on-screen text that repeats the narration verbatim", () => {
  const lines = [{ text: "撑起估值的是星链。" }, { text: "2025年收入约187亿美元，" }];
  const tl = { scenes: [
    { id: "a", type: "footage", lines, props: { title: { text: "撑起估值的是星链" } }, overlays: [{ type: "word", text: "$187亿" }] },
    { id: "b", type: "bullets", lines, props: { items: [{ label: "2025年收入约187亿美元" }] }, overlays: [] },
    { id: "q", type: "quote", lines, props: { text: "撑起估值的是星链。" } },
  ] };
  assert.deepEqual(echoGate(tl, {}).map((i) => i.msg.match(/^scene "(\w+)": on-screen "([^"]+)"/).slice(1)), [["a", "撑起估值的是星链"], ["b", "2025年收入约187亿美元"]]);
  assert.deepEqual(echoGate(tl, { gates: { echoMinChars: 20 } }), []);
});

test("the SpaceX examples' screens do not echo their narration", () => {
  const ex = example();
  const { timeline } = compileTimeline({ ...ex, assets: ex.fetchedAssets });
  assert.deepEqual(echoGate(timeline, ex.config), []);
});
