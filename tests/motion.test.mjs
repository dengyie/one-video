import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { AUTO_SHOTS, MOTION_SFX, bestOffset, compileShots, compileTimeline, hardCuts, motionCues, rampShots, resolveWhen, screenEvents, sfxVariants, stillShots } from "../cli/lib/timeline/index.mjs";
import { captionBand } from "../cli/lib/captions/index.mjs";
import { beatsFile, detectBeats, everyFourth, gridBeats, snapToBar, snapToBeat } from "../cli/lib/audio/beats.mjs";
import { openingGate, rhythmGate, schemaGate } from "../cli/lib/review/gates.mjs";
import { coverPoint, dodgeX, hexLuminance, nearCentroid, rampTime, scrimFor, subjectFocus } from "../cli/lib/vision/subject.mjs";
import { example } from "./helpers.mjs";

const lines = [{ start: 0, end: 1.8 }, { start: 2, end: 3.9 }, { start: 4.1, end: 6 }];
const ctx = (over = {}) => ({ cues: { boom: 1.5 }, lines, duration: 6, start: 10, beats: [], snap: true, ...over });

test("resolveWhen: cue, seconds, and the nth beat from the scene start", () => {
  assert.deepEqual(resolveWhen({ cue: "boom", offset: 0.2 }, ctx()), { t: 1.7 });
  assert.equal(resolveWhen({ at: 2.5 }, ctx()).t, 2.5);
  const c = ctx({ beats: [9.5, 10.25, 10.75, 11.25] });
  assert.equal(resolveWhen({ at: { beat: 1 } }, c).t, 0.75);
  assert.match(resolveWhen({ at: { beat: 9 } }, c).error, /past the music/);
  assert.match(resolveWhen({ cue: "nope" }, c).error, /unknown cue/);
});

test("compileShots auto: one framing per caption line, alternating moves and cuts", () => {
  const { shots, errors } = compileShots("auto", ctx());
  assert.deepEqual(errors, []);
  assert.equal(shots.length, 3);
  assert.equal(shots[0].t, 0);
  assert.equal(shots[1].zoom, AUTO_SHOTS[1].zoom);
  assert.deepEqual(shots.map((s) => s.cut), [false, false, true]);
  assert.ok(shots[1].t < lines[1].start);
});

test("compileShots: focus fits a region, times snap to a near beat only", () => {
  const { shots } = compileShots([{ at: 0 }, { at: 1.96, focus: [0.6, 0.2, 0.2, 0.25] }, { at: 4, zoom: 1.3, snap: false }], ctx({ beats: [12, 14.05] }));
  assert.equal(shots[1].t, 2); // 11.96 → beat at 12
  assert.equal(shots[1].zoom, 3); // 0.8 / 0.25 = 3.2, capped
  assert.equal(shots[1].x, 0.7);
  assert.equal(shots[1].y, 0.325);
  assert.equal(shots[2].t, 4); // snap: false keeps 14.0, not 14.05
  const loose = compileShots([{ at: 1 }], ctx({ beats: [11.5] })).shots;
  assert.equal(loose[0].t, 1); // beat 0.5 s away is out of the window
});

test("beats: synth grid, snapping, and tempo detection on a click track", () => {
  assert.deepEqual(gridBeats(120, 2), [0, 0.5, 1, 1.5, 2]);
  assert.equal(snapToBeat(1.08, [0, 1, 2]), 1);
  assert.equal(snapToBeat(1.4, [0, 1, 2]), 1.4);
  const sr = 22050, bpm = 100, dur = 12, offset = 0.21;
  const mono = new Float32Array(sr * dur);
  for (let t = offset; t < dur; t += 60 / bpm) {
    const i0 = Math.round(t * sr);
    for (let k = 0; k < 400 && i0 + k < mono.length; k++) mono[i0 + k] = Math.sin(k * 0.9) * Math.exp(-k / 80);
  }
  const res = detectBeats(mono, sr);
  assert.ok(Math.abs(res.bpm - bpm) <= 1, `bpm ${res.bpm}`);
  assert.ok(Math.abs(res.beats[0] - offset) < 0.03 || Math.abs(res.beats[1] - offset) < 0.03, `first beats ${res.beats.slice(0, 2)}`);
});

test("beats: downbeats from the accented bar phase, cuts snap to the bar", () => {
  const sr = 22050, bpm = 120, dur = 16, offset = 0.1;
  const mono = new Float32Array(sr * dur);
  // Beat 2 of every bar (index 1, 5, 9 …) is accented, so the bar starts there.
  for (let i = 0, t = offset; t < dur; i++, t += 60 / bpm) {
    const i0 = Math.round(t * sr), amp = i % 4 === 1 ? 1 : 0.35;
    for (let k = 0; k < 400 && i0 + k < mono.length; k++) mono[i0 + k] = amp * Math.sin(k * 0.9) * Math.exp(-k / 80);
  }
  const res = detectBeats(mono, sr);
  const first = res.downbeats.find((d) => d > 0.4);
  assert.ok(Math.abs(first - (offset + 0.5)) < 0.03, `downbeat ${first}`);
  assert.ok(Math.abs(res.downbeats[1] - res.downbeats[0] - 2) < 0.03);
  assert.deepEqual(everyFourth([0, 1, 2, 3, 4, 5, 6, 7, 8], 1), [1, 5]);
  const beats = [0, 0.5, 1, 1.5, 2, 2.5], downbeats = [0, 2];
  assert.equal(snapToBar(1.8, beats, downbeats), 2); // downbeat 0.2 s away; the nearest beat (1.5) is past the beat window
  assert.equal(snapToBar(2.2, beats, downbeats), 2); // 0.2 s past the downbeat, outside the beat window
  assert.equal(snapToBar(1.45, beats, downbeats), 1.5); // no downbeat near → nearest beat
  assert.equal(snapToBar(1.25, beats, downbeats), 1.25); // nothing within the window
  // A cut shot lands on the downbeat; a push-in only on the nearest beat.
  const { shots } = compileShots([{ at: 0 }, { at: 1.8, zoom: 1.2, cut: true }, { at: 3.4, zoom: 1.3 }], ctx({ beats: [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5], downbeats: [10, 12] }));
  assert.equal(shots[1].t, 2);
  assert.equal(shots[2].t, 3.5);
});

test("schema accepts shots, word overlays and the footage / parallax / canvas scenes", () => {
  const scenes = [
    { id: "a", type: "footage", shots: "auto", overlays: [{ type: "word", text: "IPO", style: "slam", at: 1 }], props: { asset: "v", ramp: [{ at: 1, speed: 0.35 }, { at: { beat: 4 }, speed: 1.6 }], title: { text: "SpaceX", behind: true, matte: { mode: "subject" } } } },
    { id: "b", type: "parallax", shots: [{ at: 0, focus: [0.2, 0.2, 0.4, 0.4] }, { at: 2, zoom: 1.2, cut: true }], props: { asset: "p", move: "orbit" } },
    { id: "c", type: "canvas", props: { items: [{ id: "x", type: "stat", x: 960, y: 540, value: 1.75, morph: [{ at: 2, type: "bar", max: 2 }] }], path: [{ focus: "x" }, { at: 3, focus: { x: 2400, y: 540 }, fly: 1.2 }], links: [{ from: "x", to: "x" }] } },
    { id: "d", type: "canvas", enter: { type: "through", duration: 0.6 }, props: { inherit: true, floor: false, path: [{ focus: { x: 0, y: 0 }, snap: false }] } },
    { id: "e", type: "footage", props: { asset: "v", ramp: [{ at: 1, speed: 2, snap: false }] } },
  ];
  assert.deepEqual(schemaGate("storyboard", { scenes }), []);
  const bad = schemaGate("storyboard", { scenes: [{ id: "x", type: "parallax", props: { asset: "p", move: "spin" } }] });
  assert.ok(bad.some((i) => /move/.test(i.msg)));
  const ex = example();
  assert.deepEqual(schemaGate("project", { ...ex.config, captions: { style: "kinetic" }, sfx: { motion: "auto" } }), []);
  assert.ok(schemaGate("project", { ...ex.config, sfx: { motion: "loud" } }).length);
});

test("compileTimeline: a slammed word clears stickers left up from earlier lines", () => {
  const ex = example({ media: ["sfx/whoosh.wav", "sfx/pop.wav", "music/inspired.mp3"] });
  const sb = structuredClone(ex.storyboard);
  sb.scenes[1] = { ...sb.scenes[1], overlays: [
    { type: "stamp", text: "old", at: 0.2 }, { type: "stamp", text: "timed", at: 0.2, duration: 9 },
    { type: "spotlight", at: 0.3 }, { type: "word", text: "NOW", style: "slam", at: 1.5, y: 0.5 }, { type: "stamp", text: "with", at: 1.4 },
  ] };
  const { timeline, errors } = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  const sc = timeline.scenes[1], by = (x) => sc.overlays.find((o) => (o.text ?? o.type) === x);
  assert.equal(by("old").end, 1.5);
  const tail = Math.round((sc.duration + 0.5) * 1000) / 1000;
  assert.deepEqual([by("timed").end, by("spotlight").end, by("with").end, by("NOW").end], [Math.min(9.2, tail), tail, tail, tail]);
});

test("compileTimeline: shot track, prop times, beats, canvas inherit", () => {
  const ex = example({ media: ["sfx/whoosh.wav", "sfx/pop.wav", "music/inspired.mp3"] });
  const sb = structuredClone(ex.storyboard);
  writeFileSync(beatsFile(join(ex.root, "public", ex.config.music.file)), JSON.stringify({ bpm: 120, beats: gridBeats(120, 200) }));
  sb.scenes[0] = {
    ...sb.scenes[0], type: "canvas", backdrop: undefined, shots: "auto",
    props: { items: [{ id: "cap", type: "stat", value: 1.75, at: 0.5, morph: [{ at: 1.5, type: "bar", value: 1.75, max: 2 }] }], path: [{ focus: "cap" }, { at: { beat: 2 }, focus: { x: 2400, y: 540 } }] },
  };
  sb.scenes[1] = { ...sb.scenes[1], type: "canvas", backdrop: undefined, props: { inherit: true, items: [{ id: "next", type: "dot", x: 2400, y: 540 }] }, overlays: [{ type: "stamp", text: "!", on: "cap" }, { type: "mark", on: "next" }] };
  const { timeline, errors } = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  const [a, b] = timeline.scenes;
  assert.ok(a.shots.length >= 1 && a.shots[0].t === 0);
  assert.equal(a.props.items[0].t, 0.5);
  assert.equal(a.props.items[0].morph[0].t, 1.5);
  assert.equal(a.props.path[1].t, 1);
  assert.ok(timeline.beats.length > 100);
  const cap = b.props.items.find((it) => it.id === "cap");
  assert.equal(cap.type, "bar");
  assert.equal(cap.settled, true);
  assert.equal(cap.morph, undefined);
  assert.equal(b.props.path[0].cut, true);
  assert.equal(b.props.path[0].t, 0);
  assert.deepEqual(b.props.path[0].focus, { x: 2400, y: 540 });
});

test("motionCues: flights, cuts, push-ins, slammed words and ramps back up to speed", () => {
  const canvas = { type: "canvas", start: 10, props: { path: [{ t: 0 }, { t: 1, fly: 0.9 }, { t: 3, fly: 1.6 }, { t: 5, cut: true }] }, overlays: [{ type: "word", t: 2 }, { type: "word", t: 4, style: "rise" }] };
  assert.deepEqual(motionCues(canvas), [{ role: "fly", at: 10.95 }, { role: "slam", at: 12 }, { role: "flyLong", at: 12.95 }, { role: "cut", at: 15 }]);
  const footage = { type: "footage", start: 0, shots: [{ t: 0, zoom: 1 }, { t: 1, zoom: 1.05 }, { t: 2, zoom: 1.3 }, { t: 3, zoom: 1, cut: true }], props: { ramp: [{ t: 0.5, speed: 0.35 }, { t: 4, speed: 1.6 }] } };
  assert.deepEqual(motionCues(footage).map((c) => [c.role, c.at]), [["push", 2], ["cut", 3], ["ramp", 3.85]]);
  assert.deepEqual(sfxVariants("whoosh-soft", { entries: [] }), ["whoosh-soft"]);
});

test("compileTimeline: sfx.motion auto adds motion sounds that yield to authored ones", () => {
  const ex = example({ media: ["sfx/whoosh.wav", "sfx/pop.wav", "music/inspired.mp3"] });
  const sb = structuredClone(ex.storyboard);
  sb.scenes[0] = {
    ...sb.scenes[0], type: "canvas", backdrop: undefined, overlays: [{ type: "word", text: "IPO", at: 0.6 }],
    props: { items: [{ id: "a", type: "stat", value: 1 }, { id: "b", type: "stat", value: 2, x: 2400, y: 540 }], path: [{ focus: "a" }, { at: 1.2, focus: "b", fly: 1.5 }, { at: 1.3, focus: "a" }] },
  };
  const config = { ...ex.config, sfx: { ...(ex.config.sfx ?? {}), overlays: "auto", motion: "auto", volume: 0.5 } };
  const { timeline, errors } = compileTimeline({ ...ex, config, storyboard: sb, assets: ex.fetchedAssets });
  assert.deepEqual(errors.filter((e) => !/^sfx ".*" missing/.test(e)), []);
  const motion = timeline.sfx.filter((s) => s.motion);
  // The slammed word takes an impact instead of ui-pop; the 1.3 s stop is too close to the 1.2 s flight.
  assert.deepEqual(motion.map((s) => s.motion), ["slam", "flyLong"]);
  assert.ok(!timeline.sfx.some((s) => s.sound.startsWith("ui-pop")));
  assert.ok(motion[0].sound.startsWith(MOTION_SFX.slam) && motion[1].sound.startsWith(MOTION_SFX.flyLong));
  assert.equal(motion[1].volume, 0.45);
});

// 8-bit gray PNG, filter 0 on every row (the decoder does not check CRCs).
function grayPng(w, h, px) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = px[y * w + x];
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("subject: nearest pixels' centroid, cover-fitted, pulled toward the centre; ramps mirror the renderer", () => {
  const w = 16, h = 9, px = new Uint8Array(w * h).fill(40);
  for (let y = 2; y <= 4; y++) for (let x = 11; x <= 13; x++) px[y * w + x] = 230;
  const c = nearCentroid(px, w, h, 0.08);
  assert.ok(Math.abs(c.x - 12.5 / 16) < 1e-9 && Math.abs(c.y - 3.5 / 9) < 1e-9);
  // A ground plane brightening toward the bottom is ignored; on its own it gives no subject.
  const ground = Uint8Array.from(px, (v, i) => (v === 230 ? v : 40 + Math.floor(i / w) * 25));
  const g = nearCentroid(ground, w, h);
  assert.ok(Math.abs(g.x - 12.5 / 16) < 1e-9 && Math.abs(g.y - 3.5 / 9) < 0.1);
  assert.equal(nearCentroid(Uint8Array.from(ground, (v, i) => 40 + Math.floor(i / w) * 25), w, h), null);
  // A 4:3 layer covering 16:9 is cropped top and bottom.
  assert.deepEqual(coverPoint({ x: 0.5, y: 0 }, 4, 3, 16, 9), { x: 0.5, y: -1 / 6 });
  assert.equal(rampTime(2, [], 30), 2);
  assert.ok(Math.abs(rampTime(2, [{ t: 0, speed: 0.5 }], 30) - 1.075) < 0.005);
  const root = mkdtempSync(join(tmpdir(), "ov-subject-"));
  mkdirSync(join(root, "public"));
  writeFileSync(join(root, "public", "p.depth.png"), grayPng(w, h, px));
  const f = subjectFocus(root, { type: "parallax", duration: 2, props: { asset: "p" } }, { p: { kind: "image", depth: "p.depth.png" } }, 30, 1920, 1080);
  assert.deepEqual(f, { x: 0.739, y: 0.406, layer: "content" });
  assert.equal(subjectFocus(root, { type: "canvas", duration: 2, props: {} }, {}, 30, 1920, 1080), null);
});

test("through: an authored focus reaches both sides of the boundary; schema takes [x, y]", () => {
  const ex = example();
  const sb = structuredClone(ex.storyboard);
  sb.scenes[1] = { ...sb.scenes[1], enter: { type: "through", focus: [0.3, 0.6] } };
  const { timeline, errors } = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  const [a, b] = timeline.scenes;
  assert.deepEqual(b.transitionIn.focus, { x: 0.3, y: 0.6, layer: "screen" });
  assert.deepEqual(a.transitionOut.focus, b.transitionIn.focus);
  assert.equal(b.transitionIn.frames, 24);
  assert.deepEqual(schemaGate("storyboard", { scenes: [{ id: "x", type: "title", enter: { type: "through", focus: [0.4, 0.5] }, props: { title: "t" } }] }).filter((i) => /focus/.test(i.msg)), []);
  assert.ok(schemaGate("storyboard", { scenes: [{ id: "x", type: "title", enter: { type: "through", focus: [2, 0.5] }, props: { title: "t" } }] }).length);
});

test("music offset: hits land on downbeats; auto compiles the track start and shifts the beats", () => {
  assert.equal(bestOffset([{ at: 1.3, w: 1 }, { at: 3.3, w: 1 }], [0, 2, 4, 6]), 0.7);
  assert.equal(bestOffset([], [0, 2]), 0);
  const tl = { fps: 30, scenes: [
    { from: 0, start: 0, shots: [{ t: 0, cut: true }, { t: 1.5, cut: true }], overlays: [{ type: "word", t: 2 }, { type: "word", style: "rise", t: 2.5 }] },
    { from: 90, start: 3, shots: [] },
  ] };
  assert.deepEqual(hardCuts(tl), [{ at: 1.5, w: 1 }, { at: 2, w: 0.5 }, { at: 3, w: 1 }]);
  const ex = example({ media: ["sfx/whoosh.wav", "sfx/pop.wav", "music/inspired.mp3"] });
  const beats = gridBeats(120, 200);
  writeFileSync(beatsFile(join(ex.root, "public", ex.config.music.file)), JSON.stringify({ bpm: 120, beats, downbeats: everyFourth(beats) }));
  const { timeline, errors } = compileTimeline({ ...ex, config: { ...ex.config, music: { ...ex.config.music, offset: "auto" } }, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  const off = timeline.music.offset;
  assert.ok(off >= 0 && off < 2);
  assert.equal(timeline.beats[0], Math.round(((Math.ceil(off / 0.5 - 1e-9) * 0.5) - off) * 1000) / 1000);
  assert.deepEqual(schemaGate("project", { ...ex.config, music: { ...ex.config.music, offset: "auto" } }), []);
  assert.ok(schemaGate("project", { ...ex.config, music: { ...ex.config.music, offset: "late" } }).length);
});

test("text over media: words dodge the depth subject, scrims follow contrast, captions read the shot", () => {
  const w = 64, h = 36, px = new Uint8Array(w * h).fill(40);
  for (let y = 10; y < 26; y++) for (let x = 26; x < 38; x++) px[y * w + x] = 230;
  const d = { width: w, height: h, pixels: px };
  assert.equal(dodgeX(d, { text: "AB", y: 0.5, size: 150 }, 1920, 1080), 0.3);
  assert.equal(dodgeX(d, { text: "AB", y: 0.12, size: 100 }, 1920, 1080), null); // above the subject
  const white = hexLuminance("#ffffff");
  assert.equal(scrimFor(white, 20), 0);
  assert.equal(scrimFor(white, 250), 1);
  assert.ok(scrimFor(hexLuminance("#FBBF24"), 150) > 0.5);
  assert.deepEqual(captionBand(undefined, 1), [0.2, 0.84, 0.8, 0.96]);
  const z = captionBand([{ t: 0, zoom: 2, x: 0.5, y: 0.5 }], 1).map((v) => Math.round(v * 1000) / 1000);
  assert.deepEqual(z, [0.35, 0.67, 0.65, 0.73]);
});

test("rhythm: long stills and transition runs warn; a covered word leaves when the next lands", () => {
  const sc = (id, start, duration, extra = {}) => ({ id, type: "media", start, duration, cues: {}, shots: [], overlays: [], transitionIn: { type: "fade" }, ...extra });
  const tl = { duration: 20, scenes: [sc("a", 0, 6, { cues: { x: 2 } }), sc("b", 6, 4), sc("c", 10, 4), sc("d", 14, 6, { shots: [{ t: 1 }] })] };
  const w = rhythmGate(tl, {}).map((i) => i.msg);
  assert.equal(w.length, 2);
  assert.match(w[0], /^5\.0s .* from 15\.0s \(scene "d"\)/);
  assert.match(w[1], /3\+ consecutive "fade" transitions ending at "d"/);
  assert.deepEqual(rhythmGate(tl, { gates: { maxStill: 6, maxSameTransitionRun: 3 } }), []);
  const quote = (captions) => ({ duration: 8, scenes: [sc("q", 0, 8, { type: "quote", captions, transitionIn: { type: "cut" }, lines: [{ start: 0.1 }, { start: 4 }] })] });
  assert.equal(rhythmGate(quote(true), {}).length, 1); // a still quote under its caption
  assert.deepEqual(rhythmGate(quote(false), {}), []); // read along: each spoken line lights up
  const chart = { duration: 9, scenes: [sc("c", 0, 9, { type: "line-chart", transitionIn: { type: "cut" }, cues: { a: 1, b: 8 }, props: { pointCues: ["a", "b"] } })] };
  assert.deepEqual(rhythmGate(chart, {}), []); // the line sets off for b at 5s
  const drift = (zoom) => ({ duration: 8, scenes: [sc("s", 0, 8, { transitionIn: { type: "cut" }, shots: [{ t: 0, zoom: 1 }, { t: 4, zoom }] })] });
  assert.equal(rhythmGate(drift(1.02), {}).length, 1); // a 2% drift is not something new
  assert.deepEqual(rhythmGate(drift(1.15), {}), []); // a real push-in is

  const ex = example({ media: ["sfx/whoosh.wav", "sfx/pop.wav", "music/bgm.wav"] });
  const sb = structuredClone(ex.storyboard);
  sb.scenes[0].overlays = [
    { type: "word", text: "凭什么", at: 0.5, duration: 2, y: 0.55 },
    { type: "word", text: "$1T+", at: 1.5, duration: 1, y: 0.5 },
    { type: "word", text: "远处", at: 1.8, duration: 1, y: 0.12 },
  ];
  const { timeline, errors } = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  const [a, b, c] = timeline.scenes[0].overlays.filter((o) => o.type === "word");
  assert.equal(a.end, b.t); // covered: yields
  assert.equal(b.end, Math.round((b.t + 1) * 1000) / 1000); // the far-off word does not cut it short
  assert.ok(c.end > c.t + 0.9);
});

test("depthStep: dense only for clips with a title cut out behind the subject", async () => {
  const { depthStep } = await import("../cli/lib/assets/index.mjs");
  const sb = { scenes: [
    { type: "footage", props: { asset: "a", title: { text: "X", behind: true } } },
    { type: "footage", props: { asset: "b", title: { text: "Y" } } },
  ] };
  assert.equal(depthStep(sb, "a"), 2);
  assert.equal(depthStep(sb, "b"), 8);
  assert.equal(depthStep(null, "b"), 2);
});

test("a speed ramp on a still becomes camera moves that leave authored shots alone", () => {
  const ramp = [{ t: 1.4, speed: 0.45 }, { t: 5.9, speed: 1.7 }, { t: 8.9, speed: 0.9 }];
  const bare = rampShots(ramp, undefined, 10);
  assert.deepEqual(bare.map((s) => s.t), [1.4, 3.65, 5.9, 8.9]);
  assert.deepEqual(bare.map((s) => s.zoom), [1.06, 1.12, 1.22, 1.28]);
  assert.equal(bare[2].ease, 0.35);
  for (const [i, s] of bare.entries()) if (i) assert.ok(s.t - bare[i - 1].t <= 4.5, "keeps the frame changing");
  // An authored push until 4.28 s: the slow push waits for it; a shot on the speed-up keeps that point.
  const own = [{ t: 0, zoom: 1, x: 0.5, y: 0.5, rotate: 0, cut: false, ease: 0.6 }, { t: 0.28, zoom: 1.2, x: 0.47, y: 0.44, rotate: 0, cut: false, ease: 4 }, { t: 5.9, zoom: 1.04, x: 0.5, y: 0.5, rotate: 0, cut: true, ease: 0.6 }];
  const mixed = rampShots(ramp, own, 10);
  assert.deepEqual(mixed.map((s) => s.t), [0, 0.28, 4.28, 5.9, 8.9]);
  assert.deepEqual(mixed[2], { t: 4.28, zoom: 1.26, x: 0.47, y: 0.44, rotate: 0, cut: false, ease: 1.62 });
  assert.equal(mixed[3], own[2]);
  assert.equal(rampShots([{ t: 0, speed: 1 }], own, 10), own);
});

test("long still stretches on a shot track get a slow drift that keeps authored moves visible", () => {
  const sh = (t, zoom, ease = 0.6) => ({ t, zoom, x: 0.5, y: 0.5, rotate: 0, cut: false, ease });
  const own = [sh(0, 1), sh(1, 1.12)];
  const out = stillShots(own, [6.5], 12, 4.5);
  assert.deepEqual(out.map((s) => [s.t, s.zoom, s.ease]), [[0, 1, 0.6], [1, 1.12, 0.6], [3.75, 1.18, 2.475], [9.25, 1.12, 2.475]]);
  const sc = { id: "s", start: 0, duration: 12, cues: { a: 6.5 }, shots: out };
  const ev = screenEvents({ scenes: [sc] }).filter((e) => !e.weak).map((e) => e.t);
  for (const [i, t] of [...ev, 12].entries()) if (i) assert.ok(t - ev[i - 1] <= 4.5, `gap before ${t}`);
  // A drift that would leave the next authored push too small to see is dropped; no track, nothing added.
  const push = [sh(0, 1), sh(5, 1.08)];
  assert.equal(stillShots(push, [], 6, 4.5), push);
  assert.equal(stillShots(undefined, [], 10, 4.5), undefined);
  // A move still travelling holds the drift back until it lands.
  assert.deepEqual(stillShots([sh(0, 1), sh(0.5, 1.1, 4)], [], 6, 4.5).map((s) => s.t), [0, 0.5, 4.5]);
});

test("opening: a text-led hook whose first reveal waits past 2.5 s warns", () => {
  const hook = (over = {}) => ({ scenes: [{ id: "hook", type: "kinetic", start: 0, duration: 15, backdrop: { asset: "a" }, cues: { quit: 4.04 },
    props: { kicker: "2026", lines: [{ text: "辞任", cue: "quit" }] }, overlays: [{ type: "flash", t: 0.5 }], ...over }] });
  const [w] = openingGate(hook(), {});
  assert.match(w.msg, /first 4\.0s of "hook" show only its backdrop — reveal the hook's main line by 2\.5s/);
  assert.match(w.msg, /\(cue it on an earlier word,/, "no narration lines: no phrase");
  const spoken = openingGate(hook({ lines: [{ text: "“2026年11月12日”，黄仁勋辞去", start: 0.15 }, { text: "辞去CEO", start: 3 }] }), {})[0];
  assert.match(spoken.msg, /move cue "quit" to "2026年11月12日" \(0\.1s\)/);
  assert.deepEqual(spoken.at, { scene: "hook", from: 0, to: 4.04, field: "cues" });
  assert.deepEqual(openingGate(hook({ cues: { quit: 1.8 } }), {}), []);
  assert.deepEqual(openingGate(hook({ overlays: [{ type: "word", t: 1 }] }), {}), []);
  assert.deepEqual(openingGate(hook({ props: { lines: [{ text: "辞任" }, { text: "x", cue: "quit" }] } }), {}), [], "an uncued line shows right away");
  assert.deepEqual(openingGate(hook({ props: { title: "辞任" } }), {}), [], "nothing timed: all there from the start");
  assert.deepEqual(openingGate(hook({ type: "footage" }), {}), []);
  assert.deepEqual(openingGate(hook(), { gates: { hookReveal: 5 } }), []);
});

test("resolveWhen refuses a beat past the scene end", () => {
  const ctx = { cues: {}, lines: [], duration: 4, start: 10, beats: [10, 11, 12, 13, 14.5, 16] };
  assert.equal(resolveWhen({ at: { beat: 3 } }, ctx).t, 3);
  assert.match(resolveWhen({ at: { beat: 4 } }, ctx).error, /past the 4s scene/);
});
