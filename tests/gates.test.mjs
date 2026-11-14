import { test } from "node:test";
import assert from "node:assert/strict";
import { schemaGate, numbersGate, captionGate, storyboardGate, rateGate, assetsGate, budgetGate, timingsGate, normalizeLicense, summarize, questionGate, echoGate, layoutGate, densityGate } from "../cli/lib/review/gates.mjs";
import { rhythmGate, screenEvents } from "../cli/lib/review/gates.mjs";
import { checkNotes, checkTone, matchGates, meanLuma, mergePasses, median, noteKind, toneOf } from "../cli/lib/review/look-check.mjs";
import { compileTimeline } from "../cli/lib/timeline/index.mjs";
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

test("storyboardGate: pointCues must reference defined cues", () => {
  const ex = example();
  const sb = structuredClone(ex.storyboard);
  sb.scenes.find((s) => s.type === "line-chart").props.pointCues = [null, "gone"];
  assert.ok(msgs(storyboardGate(sb, ex.script, ex.config, null), "cues").some((x) => /"gone"/.test(x)));
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
  assert.equal(normalizeLicense("GODL-India"), null);
  assert.equal(normalizeLicense("CC BY-NC 4.0"), null);
  assert.equal(normalizeLicense("All rights reserved"), null);
});

test("schemaGate: assets accept the clipPick that fetch writes", () => {
  const item = (clipPick) => ({ items: [{ id: "f", kind: "video", url: "https://x/f.webm", license: "Public domain", clip: [3, 20], clipPick }] });
  assert.deepEqual(schemaGate("assets", item({ model: "m", at: 3, saw: "a street", reason: "r" })).filter((i) => i.level === "error"), []);
  assert.deepEqual(schemaGate("assets", item({ model: "m", at: null, reason: null, fits: false })).filter((i) => i.level === "error"), []);
  assert.ok(schemaGate("assets", item({ model: "m", at: 3, typo: 1 })).some((i) => i.level === "error"));
});

test("assetsGate: a film that fits nothing is flagged; two windows of one film are not the same media", () => {
  const film = { kind: "video", file: "assets/a.mp4", license: "PD", source: "https://archive.org/details/f", width: 1280, height: 720 };
  const issues = assetsGate({ items: [
    { ...film, id: "a", clip: [10, 20] },
    { ...film, id: "b", clip: [300, 20], query: "stock market", clipPick: { model: "m", at: null, reason: "all animation", fits: false } },
    { ...film, id: "c", clip: [10, 20] },
  ] });
  assert.deepEqual(issues.map((i) => i.msg.replace(/\(.*$/, "").trim()), [
    'asset "b": no frame of its film shows "stock market"',
    'assets "a" and "c" are the same source media',
  ]);
});

test("assetsGate: a soft asset is flagged only when the timeline shows it", () => {
  const items = [{ id: "low", file: "assets/low.webm", license: "PD", width: 640, height: 480 }, { id: "hd", file: "assets/hd.jpg", license: "PD", width: 1920, height: 1080 }];
  const soft = (used) => assetsGate({ items }, {}, used).filter((i) => /look soft/.test(i.msg)).length;
  assert.equal(soft(), 1);
  assert.equal(soft(new Set(["low", "hd"])), 1);
  assert.equal(soft(new Set(["hd"])), 0);
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

test("numbersGate checks the spoken lines, not a stale narration", () => {
  const research = { facts: [{ id: "a", claim: "营收 300 亿", source: { title: "t" } }] };
  const script = { scenes: [{ id: "s", narration: "营收 300 亿", lines: ["营收 450 亿"] }] };
  assert.match(numbersGate(script, research).map((i) => i.msg).join("\n"), /"450亿"/);
});

test("layoutGate: overlays over spoken captions, off-frame, tiny or stacked stickers, text pushed out by a shot", () => {
  const base = { width: 1920, height: 1080, captions: { enabled: true, style: "line", items: [{ scene: "a", text: "说话中", start: 1, end: 3 }] } };
  const scene = (over) => ({ id: "a", type: "media", start: 0, duration: 6, shots: [{ t: 0, zoom: 1, x: 0.5, y: 0.5 }], overlays: [], ...over });
  const run = (sc) => layoutGate({ ...base, scenes: [scene(sc)] }, {});
  const img = (x, y, size, t = 0, end = 5) => ({ type: "image", asset: "p", x, y, size, t, end });

  assert.deepEqual(run({ overlays: [img(0.8, 0.34, 320)] }), []);
  const band = run({ overlays: [img(0.5, 0.86, 300)] });
  assert.ok(band.some((i) => i.level === "error" && /caption band/.test(i.msg)));
  // Shown only after the caption ends: no clash.
  assert.ok(!run({ overlays: [img(0.5, 0.86, 300, 3.5, 5)] }).some((i) => /caption band/.test(i.msg)));
  assert.ok(run({ overlays: [img(0.97, 0.3, 300)] }).some((i) => /off the frame/.test(i.msg)));
  assert.ok(run({ overlays: [img(0.8, 0.3, 160)] }).some((i) => /thumbnail/.test(i.msg)));
  assert.ok(run({ overlays: [img(0.4, 0.3, 300), img(0.45, 0.32, 300)] }).some((i) => /overlaps overlay 0/.test(i.msg)));
  // A keyword clear of the band at first, carried into it by a push-in partway through the line.
  const word = (y) => ({ type: "word", text: "≈48亿美元", x: 0.5, y, t: 0, end: 5 });
  const push = [{ t: 0, zoom: 1, x: 0.5, y: 0.5 }, { t: 2, zoom: 1.16, x: 0.5, y: 0.45, ease: 0.6 }];
  assert.deepEqual(run({ overlays: [word(0.74)] }), []);
  assert.ok(run({ overlays: [word(0.74)], shots: push }).some((i) => i.level === "error" && /word "≈48亿美元"\) sits in the caption band/.test(i.msg)));
  assert.deepEqual(run({ overlays: [word(0.6)], shots: push }), []);

  const left = run({ type: "kinetic", props: { align: "left" }, shots: [{ t: 0, zoom: 1.15, x: 0.5, y: 0.5 }] });
  assert.ok(left.some((i) => /left edge/.test(i.msg)));
  assert.deepEqual(run({ type: "kinetic", props: { align: "center" }, shots: [{ t: 0, zoom: 1.15, x: 0.5, y: 0.5 }] }), []);
  assert.ok(run({ type: "kinetic", props: {}, shots: [{ t: 0, zoom: 1.4, x: 0.5, y: 0.5 }] }).some((i) => /maxTextZoom/.test(i.msg)));

  // A keyword parked on a map pin once the camera has flown in to it.
  const map = (y, extra = {}) => ({ type: "map", cues: { sg: 1 }, props: { views: [{ center: [105, 12], zoom: 2.2 }, { center: [103.8, 1.4], zoom: 9, cue: "sg" }], pins: [{ lon: 103.82, lat: 1.35, label: "总部", cue: "sg" }], ...extra }, overlays: [{ ...word(y), t: 2 }] });
  assert.ok(run(map(0.6)).some((i) => /covers the map pin/.test(i.msg)));
  assert.ok(run(map(0.45)).some((i) => /covers the map label "总部"/.test(i.msg)));
  assert.ok(!run(map(0.25)).some((i) => /covers the map/.test(i.msg)));
  // Every element it covers is named; a globe centres the view at mid-frame.
  assert.ok(run(map(0.5)).some((i) => /covers the map pin, label "总部"/.test(i.msg)));
  assert.ok(run(map(0.5, { mode: "globe" })).some((i) => /covers the map pin/.test(i.msg)));
  assert.ok(!run(map(0.62, { mode: "globe" })).some((i) => /covers the map/.test(i.msg)));
  // Country labels: centred on the country, or dropped under a pin that sits there.
  const us = (y, extra = {}) => ({ type: "map", cues: {}, props: { views: [{ center: [-98, 39], zoom: 3 }], highlight: [{ id: "840", label: "美国" }], ...extra }, overlays: [{ type: "word", text: "关税", x: 0.53, y, t: 2, end: 5 }] });
  assert.ok(run(us(0.4)).some((i) => /covers the map label "美国"/.test(i.msg)));
  assert.ok(!run(us(0.75)).some((i) => /covers the map/.test(i.msg)));
  const sg = (y) => map(y, { highlight: [{ id: "702", label: "新加坡", cue: "sg" }], pins: [{ lon: 103.82, lat: 1.35, cue: "sg" }] });
  assert.ok(run(sg(0.66)).some((i) => /covers the map label "新加坡"/.test(i.msg)));
});

test("densityGate: assets per minute, AI-generated ones counted, bare text scenes flagged", () => {
  const sc = (id, type, duration, extra = {}) => ({ id, type, duration, props: {}, overlays: [], ...extra });
  const tl = (scenes) => ({ duration: scenes.reduce((s, x) => s + x.duration, 0), scenes });
  const assets = { items: [{ id: "g", generate: { prompt: "x" } }, { id: "p1", license: "CC0" }] };
  const photos = (n) => Array.from({ length: n }, (_, i) => ({ type: "image", asset: `p${i}` }));

  const thin = densityGate(tl([sc("a", "media", 60, { props: { asset: "p1" }, overlays: [{ type: "image", asset: "g" }] })]), assets, {});
  assert.ok(thin.some((i) => i.level === "error" && /2 assets \(1 AI-generated\) in 60s/.test(i.msg)));
  assert.deepEqual(densityGate(tl([sc("a", "media", 60, { overlays: [...photos(7), { type: "image", asset: "g" }] })]), assets, {}), []);
  const mid = densityGate(tl([sc("a", "media", 60, { overlays: photos(5) })]), assets, {});
  assert.deepEqual(mid.map((i) => i.level), ["warn"]);
  assert.deepEqual(densityGate(tl([sc("a", "media", 60, { overlays: photos(8) })]), assets, {}), []);
  assert.deepEqual(densityGate(tl([sc("a", "media", 60)]), assets, { gates: { minAssetsPerMinute: 0, goodAssetsPerMinute: 0 } }), []);

  const bare = densityGate(tl([sc("a", "media", 50, { overlays: photos(8) }), sc("q", "quote", 8), sc("k", "kinetic", 4), sc("c", "bar-race", 9), sc("s", "sources", 9)]), assets, {});
  assert.deepEqual(msgs(bare, "density").filter((m) => /no photo/.test(m)).length, 1);
  assert.ok(bare.some((i) => /scene "q"/.test(i.msg)));
});

// A hand-built timeline: scene a 0–10s with a cue at 3s, a weak drift at 5s and a real push at 6s;
// scene b 10–20s with only an overlay at 12s.
const lookTl = () => ({ duration: 20, scenes: [
  { id: "a", type: "media", start: 0, duration: 10, cues: { v: 3 }, shots: [{ t: 0, zoom: 1 }, { t: 5, zoom: 1.02 }, { t: 6, zoom: 1.15 }], overlays: [] },
  { id: "b", type: "media", start: 10, duration: 10, cues: {}, shots: [{ t: 0, zoom: 1 }], overlays: [{ t: 2 }] },
] });

test("screenEvents: every on-screen change in timeline time, barely-moving shots marked weak", () => {
  const ev = screenEvents(lookTl());
  assert.deepEqual(ev.filter((e) => e.scene === "a").map((e) => [e.t, e.what, !!e.weak]),
    [[0, "scene", false], [0, "shot", false], [3, "cue", false], [5, "shot", true], [6, "shot", false]]);
  assert.deepEqual(ev.filter((e) => e.what === "overlay").map((e) => e.t), [12]);
  const rot = screenEvents({ scenes: [{ id: "r", start: 0, duration: 5, shots: [{ t: 0 }, { t: 2, rotate: 4 }] }] });
  assert.equal(rot.find((e) => e.t === 2).weak, undefined); // a turn of the frame is a change
});

test("checkNotes: still/late notes the timeline contradicts are marked doubtful, others kept as they are", () => {
  const notes = [
    { t: 4, issue: "画面静止无变化", span: [2, 7] }, // cue 3, push 6: never more than 3s
    { t: 15, kind: "still", issue: "背景单调", span: [13, 19] }, // nothing after the 12s overlay
    { t: 2.5, issue: "数值到后面才出现" }, // cue at 3s, on its word
    { t: 16, kind: "late", issue: "标签没出现" }, // no reveal after 16s
    { t: 8, issue: "文字压住人脸" },
    { t: 9, scene: "a", issue: "画面无变化", span: [8, 12] }, // b's start and overlay are not a's
    { t: 4, issue: "0-7秒画面静止" }, // span read off the wording: 0→3 cue→6 push→7
    { t: 15, issue: "画面偏空" }, // composition, not stillness
  ];
  assert.equal(checkNotes(lookTl(), notes), 3);
  assert.deepEqual(notes.map((n) => n.check?.doubtful), [true, false, true, false, undefined, false, true, undefined]);
  assert.match(notes[0].check.why, /3\.0s cue, 6\.0s shot/);
  assert.doesNotMatch(notes[0].check.why, /5\.0s/); // the weak drift does not count
  assert.match(notes[2].check.why, /cue reveals at 3\.0s/);
  assert.equal(noteKind({ issue: "x", kind: "late" }), "late");
  assert.equal(noteKind({ issue: "时间轴约5秒无新元素" }), "still");
  assert.equal(checkNotes(null, notes), 0);
});

test("mergePasses: median score, a point several models raise counts once with how many saw it", () => {
  const n = (t, scene, issue, severity = "medium") => ({ t, scene, issue, severity });
  const { score, notes } = mergePasses([
    { score: 6, notes: [n(10, "a", "画面静止"), n(30, "b", "文字太小")] },
    { score: 8, notes: [n(11.5, "a", "无变化", "high"), n(40, "b", "裁切不当")] },
    { score: 7, notes: [n(11, "b", "画面静止")] }, // other scene: not the same point
  ], { near: 2 });
  assert.equal(score, 7);
  assert.deepEqual(notes.map((x) => [x.t, x.scene, x.seen, x.severity]), [[10, "a", 2, "high"], [11, "b", 1, "medium"], [30, "b", 1, "medium"], [40, "b", 1, "medium"]]);
  assert.equal(notes[0].issue, "无变化"); // the most severe wording, at the first pass's time
  assert.equal(median([3, null, 9, 4, 1]), 3.5);
  assert.equal(mergePasses([{ score: null, notes: [] }]).score, null);
});

test("checkTone: dark/bright claims held against the video's median, jumps against the frame before the cut", () => {
  assert.equal(toneOf({ issue: "切入明亮背景，与暗色前段反差突兀" }), "jump");
  assert.equal(toneOf({ issue: "画面偏暗看不清" }), "dark");
  assert.equal(toneOf({ issue: "背景过曝" }), "bright");
  assert.equal(toneOf({ issue: "文字太小" }), null);
  assert.equal(checkTone("dark", { luma: 0.2, median: 0.18 }).doubtful, true);
  assert.equal(checkTone("dark", { luma: 0.08, median: 0.18 }).doubtful, false);
  assert.equal(checkTone("bright", { luma: 0.19, median: 0.18 }).doubtful, true);
  assert.equal(checkTone("bright", { luma: 0.4, median: 0.18 }).doubtful, false);
  assert.match(checkTone("jump", { luma: 0.22, median: 0.2, before: 0.18 }).why, /18% → 22% across the cut: no real jump/);
  assert.equal(checkTone("jump", { luma: 0.4, median: 0.2, before: 0.1 }).doubtful, false);
  assert.equal(checkTone("jump", { luma: 0.4, median: 0.2 }), null); // nothing before the first scene
  assert.equal(checkTone("dark", { luma: NaN, median: 0.2 }), null);
  assert.ok(Math.abs(meanLuma(Buffer.from([255, 255, 255, 0, 0, 0])) - 0.5) < 1e-9);
});

test("matchGates: a note a timeline gate also flags, in its scene and stretch, is confirmed", () => {
  const issues = rhythmGate(lookTl(), {});
  assert.deepEqual(issues[0].at, { scene: "b", from: 12, to: 20 });
  const notes = [
    { t: 15, scene: "b", issue: "画面长时间静止" },
    { t: 15, scene: "b", issue: "贴纸偏小" },
    { t: 15, scene: "a", issue: "画面静止" },
    { t: 8, scene: "b", issue: "画面静止" },
    { t: 15, scene: "b", issue: "画面静止", check: { doubtful: true } },
  ];
  const small = { level: "warn", gate: "layout", msg: "small", at: { scene: "b", from: 14, to: 16 } };
  assert.equal(matchGates(notes, [...issues, { level: "warn", gate: "layout", msg: "unplaced" }, small]), 2);
  assert.match(notes[0].gate.msg, /^8\.0s with nothing new on screen from 12\.0s/);
  assert.deepEqual(notes[1].gate, { gate: "layout", msg: "small" }, "placement notes meet layout, not rhythm");
  assert.equal(notes[2].gate, undefined);
  assert.equal(notes[3].gate, undefined);
  assert.equal(notes[4].gate, undefined, "the timeline already contradicts it");
  const opening = { level: "warn", gate: "opening", msg: "o", at: { scene: "a", from: 0, to: 4 } };
  const early = [{ t: 1, scene: "a", issue: "字幕位置不统一" }, { t: 3, scene: "a", issue: "开场画面无新变化" }];
  assert.equal(matchGates(early, [opening]), 1);
  assert.equal(early[1].gate.gate, "opening", "only a stall or late reveal meets the opening gate");
});
