import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileTimeline, phraseTime, resolveAt, mergeTheme, researchSources, sourceList, credit, CUE_LEAD, boundaryTransition, transitionSfx } from "../cli/lib/timeline/index.mjs";
import { example, ROOT } from "./helpers.mjs";
import { mutedBackdrop, placeCaptions } from "../cli/lib/captions/layout.mjs";
import { linePointTimes, lineProgress, lineSegmentStart } from "../shared/line-reveal.mjs";
import { prepareCutMusic, loadMusicGrid, compileMusic } from "../cli/lib/audio/music.mjs";
import { beatsFile, gridBeats } from "../cli/lib/audio/beats.mjs";
import { readWav } from "../cli/lib/audio/wav.mjs";

test("a re-timed cut gets its own story arrangement long enough to play without looping", () => {
  const { root } = example({ media: ["music/bgm.wav"] });
  const base = join(root, "public", "music", "bgm.wav");
  writeFileSync(base, "original score");
  writeFileSync(beatsFile(base), JSON.stringify({
    source: "synth:story", scored: true, cut: { open: 0, finish: 3 },
    sections: [{ mood: "intro", start: 0, end: 3 }, { mood: "resolve", start: 3, end: 5 }],
  }));
  const config = { preset: "story", arc: [{ at: "open", mood: "intro" }, { at: "finish", mood: "resolve" }] };
  const script = { scenes: [{ id: "open" }, { id: "finish" }] };
  const grid = loadMusicGrid(root, config);
  const compile = (duration, start, warnings = []) => {
    const scenes = [{ id: "open", start: 0 }, { id: "finish", start }];
    return { music: compileMusic(config, { root, offset: 0, grid, scenes, script, duration, warnings }), scenes, duration };
  };
  const original = compile(4, 3);
  const longer = compile(7, 6);
  assert.equal(prepareCutMusic(root, config, original, script), false);
  assert.equal(longer.music.src, "music/bgm.wav");
  assert.equal(prepareCutMusic(root, config, longer, script), true);
  const warnings = [];
  const updated = compile(7, 6, warnings);
  assert.match(updated.music.src, /^music\/story-[a-f0-9]+\.wav$/);
  assert.equal(readWav(join(root, "public", updated.music.src)).duration, 9);
  assert.deepEqual(warnings, []);
  assert.equal(prepareCutMusic(root, config, updated, script), false);
  assert.equal(compile(4, 3).music.src, "music/bgm.wav");
  assert.equal(readFileSync(base, "utf8"), "original score");
});

test("an extended story score resolves late beat cues before the audio is generated", () => {
  const { root } = example({ media: ["music/bgm.wav"] });
  const beats = gridBeats(80, 5);
  writeFileSync(beatsFile(join(root, "public", "music", "bgm.wav")), JSON.stringify({
    source: "synth:story", scored: true, beats, downbeats: [0, 3], cut: { open: 0, finish: 3 },
    sections: [{ mood: "intro", start: 0, end: 3 }, { mood: "resolve", start: 3, end: 5 }],
  }));
  const config = { music: { preset: "story", arc: [{ at: "open", mood: "intro" }, { at: "finish", mood: "resolve" }] } };
  const script = { scenes: [{ id: "open" }, { id: "finish" }] };
  const storyboard = { scenes: [
    { id: "open", type: "title", duration: 6, props: { title: "Open" } },
    { id: "finish", type: "title", duration: 3, props: { title: "Finish" }, shots: [
      { at: 0 }, { at: { beat: 1 }, zoom: 1.1 }, { at: 1.54, zoom: 1.05 },
    ] },
  ] };
  const compile = () => compileTimeline({ root, config, script, storyboard });
  const first = compile();
  assert.deepEqual(first.errors, []);
  assert.equal(prepareCutMusic(root, config.music, first.timeline, script), true);
  const { timeline, errors } = compile();
  assert.deepEqual(errors, []);
  assert.match(timeline.music.src, /^music\/story-[a-f0-9]+\.wav$/);
  assert.equal(readWav(join(root, "public", timeline.music.src)).duration, 11);
  assert.deepEqual(timeline.scenes[1].shots.filter((s) => s.k !== undefined).map((s) => s.t), [0, 0.75, 1.5]);
  assert.ok(timeline.beats.includes(8.25));
});

test("line draws to cued points without shifting or previewing their values", () => {
  const times = linePointTimes({ duration: 12, cues: { start: 2, next: 2.2, last: 9 } }, 4, ["start", "next", null, "last"], 0.5);
  assert.deepEqual(times, [2, 2.2, 5.6, 9]);
  assert.equal(lineProgress(times, 2), 0);
  assert.equal(lineProgress(times, 2.2), 1);
  assert.equal(lineProgress(times, lineSegmentStart(5.6, 9)), 2);
  assert.equal(lineProgress(times, 9), 3);
  assert.equal(linePointTimes({ duration: 6 }, 2, ["missing"], 0), null);
});

test("compiled defaults break fade chains at chapter turns without overriding an authored fade", () => {
  const ex = example();
  const args = { ...ex, assets: ex.fetchedAssets };
  const render = () => compileTimeline(args).timeline.scenes;
  const cuts = render().slice(1).map((s) => s.transitionIn.type);
  assert.ok(cuts.includes("cut") && !cuts.join(" ").includes("fade fade fade"));
  const cut = cuts.indexOf("cut") + 1;
  ex.storyboard.scenes[cut].enter = "fade";
  assert.equal(render()[cut].transitionIn.type, "fade");
});

test("mixed-source scenes dissolve across the visual cut without shifting narration or captions", () => {
  const read = (file) => JSON.parse(readFileSync(join(ROOT, "examples", "mixed-source", file), "utf8"));
  const config = read("onevideo.json");
  const script = read("plan/script.json");
  const storyboard = read("plan/storyboard.json");
  const assets = read("plan/assets.json");
  assets.items = assets.items.map((a) => ({
    ...a, file: `assets/${a.id}.${a.kind === "video" ? "mp4" : "jpg"}`,
    ...(a.generate && { license: "generated" }),
  }));
  const timings = { scenes: Object.fromEntries(storyboard.scenes.map((s, i) => [s.id, {
    file: `audio/${s.id}.wav`, duration: 10 - s.hold,
    lines: [{ text: script.scenes[i].narration, start: 0.15, end: 2 }],
  }])) };
  const { errors, timeline } = compileTimeline({ config, script, storyboard, assets, timings });
  assert.deepEqual(errors, []);
  const { scenes, narration, captions } = timeline;
  assert.deepEqual(scenes.map((s) => [
    s.props.asset, timeline.assets[s.props.asset].kind, timeline.assets[s.props.asset].generated ?? false,
  ]), [["launch", "video", false], ["bootprint", "image", false], ["horizon", "image", true]]);
  assert.equal(timeline.assets.horizon.credit, null);
  assert.equal(timeline.totalFrames, 900);
  assert.deepEqual(scenes.map((s) => [s.from, s.durationInFrames, s.audio]), [
    [0, 300, "audio/launch.wav"], [300, 300, "audio/bootprint.wav"], [600, 300, "audio/horizon.wav"],
  ]);
  assert.deepEqual(scenes.slice(1).map((s) => s.transitionIn), [
    { type: "fade", frames: 18, lead: 9, direction: "left" },
    { type: "fade", frames: 21, lead: 10, direction: "left" },
  ]);
  assert.deepEqual(scenes.slice(0, -1).map((s) => s.transitionOut), [
    { type: "fade", frames: 18, tail: 9, direction: "left", nextOpaque: true },
    { type: "fade", frames: 21, tail: 11, direction: "left", nextOpaque: true },
  ]);
  assert.deepEqual(narration, [[0.15, 2], [10.15, 12], [20.15, 22]]);
  assert.deepEqual(captions.items.map((line) => [line.start, line.end]), narration);

  const portrait = compileTimeline({
    config: { ...config, aspect: "9:16", width: undefined, height: undefined }, script, storyboard, assets, timings,
  });
  assert.deepEqual(portrait.errors, []);
  assert.deepEqual([portrait.timeline.width, portrait.timeline.height], [1080, 1920]);
  assert.deepEqual(portrait.timeline.scenes.slice(1).map((s) => [s.type, s.props.fit]), [
    ["media", "contain"], ["media", "contain"],
  ]);
  assert.deepEqual(portrait.timeline.scenes.map((s) => s.transitionIn), scenes.map((s) => s.transitionIn));
  assert.deepEqual(portrait.timeline.narration, narration);
  assert.deepEqual(portrait.timeline.captions, captions);

  delete assets.items.find((a) => a.id === "horizon").file;
  assert.deepEqual(compileTimeline({ config, script, storyboard, assets, timings }).errors, [
    'asset "horizon" not fetched yet; run: onevideo assets fetch',
  ]);
});

const lines = [{ text: "1990年，全球第一", start: 0.2, end: 2.2 }, { text: "36年后，苹果排第一", start: 2.5, end: 4.5 }];

test("phraseTime interpolates inside a line and spans punctuation", () => {
  assert.equal(phraseTime(lines, "1990年"), 0.2);
  const t = phraseTime(lines, "苹果");
  assert.ok(t > 2.5 && t < 4.5);
  assert.equal(phraseTime(lines, "不存在"), null);
  // Digits weigh 1.6 syllables: "36年后" is 5.2 of the line's 10.2, so 苹果 lands past the middle.
  const share = (phraseTime(lines, "苹果") - 2.5) / 2;
  assert.ok(Math.abs(share - 5.2 / 10.2) < 1e-9);
});

test("resolveAt accepts seconds, negative seconds, phrases and {phrase, offset}", () => {
  assert.deepEqual(resolveAt(1.5, lines, 6), { t: 1.5 });
  assert.deepEqual(resolveAt(-1, lines, 6), { t: 5 });
  assert.ok(Math.abs(resolveAt({ phrase: "36年后", offset: -0.4 }, lines, 6).t - (2.1 - CUE_LEAD)) < 1e-9, "phrase cues lead the voice");
  assert.match(resolveAt("缺失", lines, 6).error, /not found/);
  assert.match(resolveAt({ offset: 1 }, lines, 6).error, /invalid cue/);
});

test("mergeTheme merges nested objects one level deep", () => {
  const m = mergeTheme({ colors: { a: 1, b: 2 }, background: "grid" }, { colors: { b: 3 }, background: "stars" });
  assert.deepEqual(m, { colors: { a: 1, b: 3 }, background: "stars" });
});

test("researchSources dedupes and keeps sources without URLs", () => {
  const src = researchSources({
    facts: [
      { source: { publisher: "Reuters", title: "定价", date: "2026-06-11" } },
      { source: { publisher: "Reuters", title: "定价", date: "2026-06-11", url: "https://x" } },
    ],
    sources: [{ publisher: "FT", title: "Global 500" }],
  });
  assert.deepEqual(src, [{ line: "Reuters · 定价 · 2026-06-11", url: "https://x" }, { line: "FT · Global 500", url: null }]);
});

test("sourceList appends asset credits; generated assets are not named in the video", () => {
  const list = sourceList({ facts: [] }, { items: [{ title: "Falcon", author: "NASA", license: "PD (NASA)" }, { license: "generated", author: "gpt-image-2.5" }] });
  assert.deepEqual(list, ["图片：Falcon · NASA · PD (NASA)"]);
  assert.equal(credit({ license: "generated" }), null);
  const used = sourceList({ facts: [] }, { items: [{ id: "a", title: "A", license: "CC0" }, { id: "b", title: "B", license: "CC0" }] }, [], new Set(["b"]));
  assert.deepEqual(used, ["图片：B · CC0"]);
});

test("compileTimeline on the SpaceX example: frames, captions, cues, chapters, music credit", () => {
  const ex = example({ media: ["sfx/whoosh.wav", "sfx/pop.wav", "music/inspired.mp3"] });
  const { timeline, errors } = compileTimeline({ ...ex, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  assert.equal(timeline.width, 1920);
  assert.deepEqual(timeline.scenes.find((s) => s.id === "race").backdrop, { asset: "pad-night", dim: 0.8, blur: 12, motion: "none", startFrom: 0 });
  assert.ok(timeline.scenes.filter((s) => s.id !== "credits").every((s) => s.backdrop), "every content scene has footage behind it");
  assert.equal(timeline.scenes.length, ex.storyboard.scenes.length);
  let frame = 0;
  for (const s of timeline.scenes) {
    assert.equal(s.from, frame, `scene ${s.id} is contiguous`);
    frame += s.durationInFrames;
  }
  assert.equal(timeline.totalFrames, frame);
  const nLines = Object.values(ex.timings.scenes).reduce((n, s) => n + s.lines.length, 0);
  assert.equal(timeline.captions.items.length, nLines);
  for (const c of timeline.captions.items) assert.ok(c.end > c.start && c.end <= timeline.duration + 1e-6);
  const race = timeline.scenes.find((s) => s.id === "race");
  assert.ok(race.cues.y1990 < race.cues.y2026);
  assert.deepEqual(timeline.chapters.map((c) => c.title).slice(0, 2), ["上市", "36 年市值榜"]);
  assert.equal(timeline.music.credit, ex.config.music.credit);
  const synth = compileTimeline({ ...example(), config: { ...ex.config, music: { preset: "pulse" } }, assets: ex.fetchedAssets });
  assert.equal(synth.timeline.music.credit, "OneVideo 程序化合成");
});

test("compileTimeline drops the caption under a quote the narrator reads aloud", () => {
  const ex = example();
  const quote = ex.storyboard.scenes.find((s) => s.type === "quote");
  const line = ex.timings.scenes[quote.id].lines.map((l) => l.text).join("，") + "。";
  const run = (patch) => {
    const sb = structuredClone(ex.storyboard);
    Object.assign(sb.scenes.find((s) => s.id === quote.id), patch(sb.scenes.find((s) => s.id === quote.id)));
    return compileTimeline({ ...ex, storyboard: sb, assets: null }).timeline.scenes.find((s) => s.id === quote.id).captions;
  };
  assert.equal(run((s) => ({ props: { ...s.props, text: line } })), false, "same words, different punctuation");
  assert.equal(run((s) => ({ props: { ...s.props, text: "另一句话" } })), true);
  assert.equal(run((s) => ({ props: { ...s.props, text: line }, captions: true })), true, "an explicit captions flag wins");
});

test("compileTimeline reports a cue phrase missing from narration", () => {
  const ex = example();
  const sb = structuredClone(ex.storyboard);
  sb.scenes.find((s) => s.id === "race").cues.bogus = "没有这句";
  const { errors } = compileTimeline({ ...ex, storyboard: sb, assets: null });
  assert.ok(errors.some((e) => /cue "bogus"/.test(e)));
});

test("compileTimeline: a provided music file needs a credit", () => {
  const ex = example({ media: ["sfx/whoosh.wav", "sfx/pop.wav", "music/track.mp3"] });
  const config = { ...ex.config, music: { file: "music/track.mp3" } };
  const { timeline, warnings } = compileTimeline({ ...ex, config, assets: null });
  assert.equal(timeline.music.src, "music/track.mp3");
  assert.ok(warnings.some((w) => /credit/.test(w)));
});

test("compileTimeline reports an unfetched asset instead of throwing", () => {
  const ex = example();
  const sb = structuredClone(ex.storyboard);
  sb.scenes[0] = { ...sb.scenes[0], props: { ...sb.scenes[0].props, asset: "rocket" } };
  const { errors } = compileTimeline({ ...ex, storyboard: sb, assets: { items: [{ id: "rocket", query: "falcon 9" }] } });
  assert.ok(errors.some((e) => /asset "rocket" not fetched/.test(e)));
});

test("boundaryTransition: enter wins over exit over theme; overlap is capped by the shorter scene", () => {
  const a = { durationInFrames: 300, exit: "wipe" };
  const b = { durationInFrames: 300, enter: { type: "whip", duration: 0.4, direction: "up" } };
  assert.deepEqual(boundaryTransition(a, b, { transition: "fade" }, 30), { type: "whip", frames: 12, lead: 6, direction: "up", sfx: undefined });
  assert.equal(boundaryTransition(a, { durationInFrames: 300 }, { transition: "fade" }, 30).type, "wipe");
  assert.equal(boundaryTransition({ durationInFrames: 300 }, { durationInFrames: 300 }, { transition: "zoom" }, 30).type, "zoom");
  assert.equal(boundaryTransition(a, { durationInFrames: 20, enter: "iris" }, {}, 30).frames, 8);
  assert.equal(boundaryTransition(a, { durationInFrames: 300, enter: "cut" }, {}, 30).frames, 0);
});

test("transitionSfx: one sound for all, or a map by type with a * fallback; cuts stay silent", () => {
  assert.equal(transitionSfx("whoosh", "fade"), "whoosh");
  assert.equal(transitionSfx("whoosh", "cut"), null);
  assert.equal(transitionSfx({ whip: "whoosh", fade: null, "*": "tick" }, "whip"), "whoosh");
  assert.equal(transitionSfx({ whip: "whoosh", fade: null, "*": "tick" }, "fade"), null);
  assert.equal(transitionSfx({ whip: "whoosh", "*": "tick" }, "iris"), "tick");
  assert.equal(transitionSfx(null, "whip"), null);
});

test("compileTimeline: adjacent scenes share one overlap window; audio starts stay put", () => {
  const ex = example({ media: ["sfx/whoosh.wav", "sfx/pop.wav", "music/inspired.mp3"] });
  const { timeline, errors } = compileTimeline({ ...ex, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  const sc = timeline.scenes;
  assert.equal(sc[0].transitionIn.lead, 0, "the opening cannot start before frame 0");
  assert.equal(sc.at(-1).transitionOut.tail, 0, "the closing cannot run past the end");
  for (let i = 1; i < sc.length; i++) {
    const tin = sc[i].transitionIn, tout = sc[i - 1].transitionOut;
    assert.equal(tin.type, tout.type);
    assert.equal(tin.frames, tout.frames);
    assert.equal(tin.lead + tout.tail, tin.frames, `boundary ${sc[i - 1].id}→${sc[i].id} is one window`);
    assert.equal(tout.nextOpaque, sc[i].opaque);
  }
  const hook = ex.storyboard.scenes.findIndex((s) => s.enter === "cut");
  if (hook > 0) assert.equal(sc[hook].transitionIn.frames, 0);
  assert.ok(sc.every((s) => s.camera.move), "every scene has a camera");
  const whooshes = timeline.sfx.filter((s) => s.sound === "whoosh").length;
  assert.equal(whooshes, sc.slice(1).filter((s) => s.transitionIn.type !== "cut").length, "one transition sound per non-cut boundary");
  for (let i = 1; i < timeline.sfx.length; i++) assert.ok(timeline.sfx[i].at >= timeline.sfx[i - 1].at, "sfx sorted by time");
});

test("watermark: a string becomes the default badge; objects take a logo asset, icon and corner", () => {
  const ex = example();
  const run = (watermark) => compileTimeline({ ...ex, assets: ex.fetchedAssets, config: { ...ex.config, watermark } });
  assert.deepEqual(run("频道名").timeline.watermark, { text: "频道名", style: "badge", position: "top-right" });
  assert.equal(run(null).timeline.watermark, null);
  const logo = ex.fetchedAssets.items[0].id;
  const r = run({ text: "频道名", sub: "每周解读", logo, icon: "rocket", position: "bottom-left" });
  assert.deepEqual(r.errors, []);
  assert.equal(r.timeline.watermark.position, "bottom-left");
  assert.ok(r.timeline.assets[logo], "logo asset is shipped with the timeline");
  assert.ok(r.timeline.icons.rocket, "icon is inlined");
  const bad = run({ text: "x", logo: "nope", position: "middle" });
  assert.ok(bad.errors.some((e) => /unknown asset "nope"/.test(e)));
  assert.ok(bad.errors.some((e) => /position "middle"/.test(e)));
});

test("captions stay at the bottom over a dimmed or blurred backdrop", () => {
  assert.equal(mutedBackdrop({ dim: 0.82, blur: 6 }), true);
  assert.equal(mutedBackdrop({ dim: 0.6, blur: 0 }), false);
  assert.equal(mutedBackdrop(undefined), false);
  // A muted backdrop is skipped before any depth map is read (root is not even a real dir).
  const caps = [{ scene: "s", start: 0, end: 1 }];
  placeCaptions([{ id: "s", type: "compare", start: 0, backdrop: { asset: "a", dim: 0.82, blur: 6 } }], caps, { root: "/nonexistent", usedAssets: {}, fps: 30, width: 1920, height: 1080 });
  assert.equal(caps[0].top, undefined);
});

test("an overlay's aspects entry replaces its spot in that frame only", () => {
  const ex = example();
  const sb = structuredClone(ex.storyboard);
  sb.scenes[0].overlays = [{ type: "stamp", text: "史上最大", x: 0.7, y: 0.3, aspects: { "9:16": { y: 0.2 } } }];
  const at = (aspect) => compileTimeline({ ...ex, config: { ...ex.config, aspect }, storyboard: sb, assets: null }).timeline.scenes[0].overlays[0];
  const wide = at("16:9"), tall = at("9:16");
  assert.deepEqual([wide.x, wide.y, "aspects" in wide], [0.7, 0.3, false]);
  assert.deepEqual([tall.x, tall.y], [0.7, 0.2]);
});
