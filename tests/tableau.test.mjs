import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  KIND_NAMES, PALETTES, bandDepth, bandFor, cameraAt, cameraMoving, cameraPoseAt, elementAt, flashAt, flashTotal, lampLevel, layerView,
  mixHex, paletteAt, settledElement, tableauTimes, waveY, SEA_BANDS,
  boxOnScreen, cameraFor, elementGeometry, insideShare, onScreen, stageOf, zoomToFit, STAGE_ASPECT,
  horizonAt, ridgeDepth, ridgeTop, stateAt, townBlocks, treeRow, windowOn,
} from "../shared/tableau.mjs";
import { resolveTableauRefs, boundaryTransition } from "../cli/lib/timeline/index.mjs";
import { framingGate, groundingGate, rhythmGate } from "../cli/lib/review/gates.mjs";
import { compileTimeline } from "../cli/lib/timeline/index.mjs";
import { schemaGate } from "../cli/lib/review/gates.mjs";
import { beatsFile, gridBeats } from "../cli/lib/audio/beats.mjs";
import { example, ROOT, estimatedTimings } from "./helpers.mjs";
import { readFileSync } from "node:fs";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("tableau local key light blends and carries into inherited scenes", () => {
  for (const type of ["lighthouse", "figure"]) {
    const el = { id: "subject", type, to: [{ t: 1, dur: 2, keyLight: 0.8 }] };
    near(elementAt(el, 0).keyLight, 0);
    near(elementAt(el, 2).keyLight, 0.4);
    near(settledElement(el, 3).keyLight, 0.8);
  }
});

test("tableau elementAt: defaults, keyframes blend over dur, entrance fade, tone cross-fade", () => {
  const lamp = { id: "lh", type: "lighthouse", x: 0.3, to: [{ t: 2, dur: 2, lit: 0 }] };
  near(elementAt(lamp, 0).h, 0.36);
  near(elementAt(lamp, 1).lit, 1);
  near(elementAt(lamp, 3).lit, 0.5);
  near(elementAt(lamp, 5).lit, 0);
  near(elementAt(lamp, 5).x, 0.3);
  const boat = { id: "b", type: "boat", t: 1, fade: 1 };
  assert.equal(elementAt(boat, 0.5).shown, false);
  near(elementAt(boat, 1.5).enter, 0.5);
  near(elementAt(boat, 3).enter, 1);
  const sky = { id: "s", type: "sky", tone: "night", to: [{ t: 1, dur: 2, tone: "dawn" }] };
  assert.equal(paletteAt([sky], 0).top, PALETTES.night.top);
  assert.equal(paletteAt([sky], 5).top, PALETTES.dawn.top);
  assert.equal(paletteAt([sky], 2).top, mixHex(PALETTES.night.top, PALETTES.dawn.top, 0.5));
  assert.equal(paletteAt([], 0), PALETTES.night);
});

test("tableau settledElement: final state, no times, no strikes", () => {
  const s = settledElement({ id: "lh", type: "lighthouse", at: 1, to: [{ at: 2, t: 2, dur: 1, lit: 0 }], strikes: [{ t: 1 }] });
  assert.deepEqual(s, { id: "lh", type: "lighthouse", lit: 0, t: 0, settled: true });
  assert.equal(elementAt(s, 0).enter, 1);
  assert.equal(elementAt(s, 0).lit, 0);
});

test("tableau camera: first key frames, flights ease, cuts jump, parallax by depth", () => {
  const keys = [{ t: 0, x: 0.5, y: 0.5, zoom: 1 }, { t: 1, x: 0.7, zoom: 2, dur: 2 }, { t: 4, x: 0.2, cut: true }];
  assert.deepEqual(cameraAt(keys, 0.5), { x: 0.5, y: 0.5, zoom: 1, sway: 0 });
  near(cameraAt(keys, 2).x, 0.6);
  near(cameraAt(keys, 2).zoom, Math.SQRT2);
  near(cameraAt(keys, 3.5).x, 0.7);
  near(cameraAt(keys, 4).x, 0.2);
  assert.equal(cameraMoving(keys, 2), true);
  assert.equal(cameraMoving(keys, 3.5), false);
  const cam = { x: 0.7, y: 0.5, zoom: 2, sway: 0 };
  const sky = layerView(cam, 0), front = layerView(cam, 1);
  near(sky.cx, 0.55); near(sky.scale, 1.25);
  near(front.cx, 0.7); near(front.scale, 2);
  assert.ok(cameraAt([{ x: 0.5, sway: 1 }], 1.7).x !== 0.5);
});

test("tableau sea, lightning and lamp", () => {
  for (let i = 0; i < SEA_BANDS; i++) {
    const y = waveY(i, 0.4, 2, 0.3, 0.66);
    assert.ok(y > 0.62 && y < 1.1, `band ${i} at ${y}`);
  }
  const calm = Math.abs(waveY(4, 0.4, 2, 0, 0.66) - waveY(4, 0.9, 2, 0, 0.66));
  const rough = Math.max(...[0.1, 0.3, 0.5, 0.7].map((x) => Math.abs(waveY(4, x, 2, 1, 0.66) - waveY(4, 0.9, 2, 1, 0.66))));
  assert.ok(rough > calm);
  assert.equal(bandFor(0.82), 2); // rides band 2; band 3 (0.86) laps over its hull
  assert.ok(bandDepth(bandFor(0.82)) <= 0.82);
  assert.equal(flashAt(-0.1), 0);
  assert.equal(flashAt(0), 1);
  assert.equal(flashAt(1), 0);
  near(flashTotal([{ type: "lightning", strikes: [{ t: 1 }, { t: 3 }] }], 3), 1);
  assert.equal(lampLevel(1, 3), 1);
  assert.equal(lampLevel(0, 3), 0);
  assert.ok(lampLevel(0.5, 3) <= 0.5);
  assert.deepEqual(tableauTimes({ elements: [{ t: 1, to: [{ t: 2 }] }, { strikes: [{ t: 0.5 }] }], camera: [{ t: 0 }, { t: 3 }] }), [0.5, 1, 2, 3]);
});

const world = [
  { id: "sky", type: "sky", tone: "night", to: [{ at: 1, dur: 2, tone: "storm" }] },
  { id: "sea", type: "sea", swell: 0.3 },
  { id: "lh", type: "lighthouse", x: 0.24 },
  { id: "bolt", type: "lightning", strikes: [{ at: 1.1 }] },
];

test("tableau schema: elements, keyframes, strikes, camera; rejects an unknown kind", () => {
  assert.ok(KIND_NAMES.includes("shore"));
  const scenes = [
    { id: "a", type: "tableau", props: { elements: world, camera: [{ x: 0.5, y: 0.5 }, { at: 1, zoom: 1.4, x: 0.3, dur: 3, sway: 0.5 }] } },
    { id: "b", type: "tableau", props: { inherit: true, elements: [{ id: "lh", to: [{ at: 0.5, lit: 0 }] }, { id: "boat", type: "boat", x: 0.6, at: 1 }] } },
  ];
  assert.deepEqual(schemaGate("storyboard", { scenes }), []);
  const bad = schemaGate("storyboard", { scenes: [{ id: "x", type: "tableau", props: { elements: [{ id: "d", type: "dragon" }] } }] });
  assert.ok(bad.length);
  const badTone = schemaGate("storyboard", { scenes: [{ id: "x", type: "tableau", props: { elements: [{ id: "s", type: "sky", tone: "noon" }] } }] });
  assert.ok(badTone.length);
});

test("compileTimeline: tableau times, strikes on the beat, inherit carries the world and camera", () => {
  const ex = example({ media: ["sfx/whoosh.wav", "sfx/pop.wav", "music/inspired.mp3"] });
  const sb = structuredClone(ex.storyboard);
  writeFileSync(beatsFile(join(ex.root, "public", ex.config.music.file)), JSON.stringify({ bpm: 120, beats: gridBeats(120, 200) }));
  sb.scenes[0] = { ...sb.scenes[0], type: "tableau", backdrop: undefined, shots: undefined, overlays: [], props: { elements: world, camera: [{ x: 0.5 }, { at: 1.1, x: 0.3, zoom: 1.5 }] } };
  sb.scenes[1] = { ...sb.scenes[1], type: "tableau", backdrop: undefined, shots: undefined, overlays: [], props: { inherit: true, elements: [{ id: "lh", to: [{ at: 0.5, lit: 0 }] }, { id: "boat", type: "boat", at: 1 }] } };
  const { timeline, errors } = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  const [a, b] = timeline.scenes;
  const by = (sc, id) => sc.props.elements.find((e) => e.id === id);
  assert.equal(by(a, "sky").to[0].t, 1);
  assert.equal(by(a, "bolt").strikes[0].t, 1); // snapped to the beat at 1.0s
  assert.equal(a.props.camera[1].t, 1);
  const sky = by(b, "sky");
  assert.equal(sky.tone, "storm");
  assert.equal(sky.settled, true);
  assert.equal(sky.to, undefined);
  assert.equal(by(b, "bolt").strikes, undefined);
  const lh = by(b, "lh");
  assert.equal(lh.type, "lighthouse");
  assert.equal(lh.x, 0.24);
  assert.equal(lh.to[0].t, 0.5);
  assert.equal(elementAt(lh, 0).enter, 1);
  assert.equal(by(b, "boat").t, 1);
  assert.equal(b.props.camera[0].cut, true);
  assert.equal(b.props.camera[0].t, 0);
  assert.equal(b.props.camera[0].x, 0.3);
  // An element continued by id with no earlier tableau is an error.
  sb.scenes[0] = { ...sb.scenes[0], type: "kinetic", props: { lines: [{ text: "x" }] } };
  const again = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.ok(again.errors.some((e) => /tableau inherit needs/.test(e)));
});

test("inherited tableau begins at the outgoing rendered camera pose in both aspects", () => {
  const ex = example();
  const sb = structuredClone(ex.storyboard);
  sb.scenes[0] = { ...sb.scenes[0], type: "tableau", backdrop: undefined, shots: undefined, overlays: [], props: {
    elements: [{ id: "tower", type: "lighthouse", x: 0.25 }, { id: "walker", type: "figure", x: 0.72 }],
    camera: [{ x: 0.25, y: 0.5, zoom: 1.1 }, { at: 1, on: "walker", zoom: 2, dur: 12, sway: 0.5 }],
  } };
  sb.scenes[1] = { ...sb.scenes[1], type: "tableau", backdrop: undefined, shots: undefined, overlays: [], props: {
    inherit: true, elements: [{ id: "walker", x: 0.3 }], camera: [{ at: 0, zoom: 1.3 }],
  } };
  for (const aspect of ["16:9", "9:16"]) {
    const { timeline, errors } = compileTimeline({ ...ex, config: { ...ex.config, aspect }, storyboard: sb, assets: ex.fetchedAssets });
    assert.deepEqual(errors, []);
    const [a, b] = timeline.scenes;
    const end = cameraPoseAt(a.props.camera, a.durationInFrames / timeline.fps);
    assert.ok(end.zoom > 1.1 && end.zoom < 2);
    assert.deepEqual(cameraPoseAt(b.props.camera, 0), end, aspect);
  }
});

test("tableau geometry: anchors, cameraFor inverts the parallax, zoomToFit fills the frame", () => {
  const frame = { W: 1920, H: 1080 };
  const lh = elementGeometry(elementAt({ type: "lighthouse", x: 0.3 }, 0), frame);
  assert.ok(lh && lh.box[1] < lh.anchors.lamp[1] && lh.anchors.lamp[1] < lh.anchors.gallery[1] && lh.anchors.gallery[1] < lh.anchors.base[1]);
  assert.equal(elementGeometry(elementAt({ type: "sea" }, 0), frame), null);
  for (const [depth, zoom, place] of [[0.9, 2, [0.5, 0.5]], [0.4, 1.6, [0.3, 0.6]], [1, 1, [0.5, 0.5]]]) {
    const cam = { ...cameraFor(lh.anchors.lamp, depth, zoom, /** @type {[number, number]} */ (place)), zoom, sway: 0 };
    const [sx, sy] = onScreen(cam, depth, lh.anchors.lamp);
    near(sx, place[0], 1e-9);
    near(sy, place[1], 1e-9);
  }
  const z = zoomToFit(lh.box, lh.depth, 0.5);
  const cam = { ...cameraFor(lh.anchors.center, lh.depth, z), zoom: z, sway: 0 };
  const b = boxOnScreen(cam, lh.depth, lh.box);
  near(b[3] - b[1], 0.5, 1e-6);
  assert.equal(insideShare(b), 1);
  assert.equal(insideShare([-0.5, 0, 0.5, 1]), 0.5);
});

test("tableau land: ridgelines recede into the haze, a town fills its spread, windows light up with lit", () => {
  for (const k of ["hills", "fog", "town", "trees", "birds", "snow"]) assert.ok(KIND_NAMES.includes(k), k);
  const hills = elementAt({ type: "hills", layers: 3, rough: 0.2 }, 0);
  const mean = (k) => { let a = 0; for (let x = 0; x <= 1; x += 0.01) a += ridgeTop(hills, k, x).y; return a / 101; };
  assert.ok(mean(0) < mean(1) && mean(1) < mean(2), "the far ridge stands highest in the frame");
  assert.ok(ridgeDepth(hills, 0) < ridgeDepth(hills, 2) && ridgeDepth(hills, 2) <= 0.9);
  const spread = (rough) => { const s = elementAt({ type: "hills", layers: 1, rough }, 0), ys = []; for (let x = 0; x <= 1; x += 0.005) ys.push(ridgeTop(s, 0, x).y); return ys.reduce((a, y, i) => (i ? a + Math.abs(y - ys[i - 1]) : 0), 0); };
  assert.ok(spread(1) > spread(0) * 1.5, "rough ridges are jagged");
  for (let x = 0; x <= 1; x += 0.1) { const r = ridgeTop(hills, 0, x); assert.ok(r.v >= 0 && r.v <= 1 && r.y < hills.y + 1e-9); }

  const town = elementAt({ type: "town", x: 0.5, spread: 0.6, count: 10 }, 0);
  const blocks = townBlocks(town);
  assert.equal(blocks.length, 10);
  near(blocks[0].x, 0.2, 1e-9);
  near(blocks.at(-1).x + blocks.at(-1).w, 0.8, 1e-9);
  assert.equal(blocks.filter((b) => b.spire).length, 1);
  assert.ok(blocks.every((b) => b.h <= town.size + 1e-9) && blocks.find((b) => b.spire).h === town.size);
  const lit = (l) => { let n = 0; for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) n += windowOn(3, r, c, 2, l) ? 1 : 0; return n; };
  assert.equal(lit(0), 0);
  assert.equal(lit(1), 36);
  assert.ok(lit(0.3) <= lit(0.7) && lit(0.3) > 0 && lit(0.7) < 36);
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if (windowOn(3, r, c, 2, 0.3)) assert.ok(windowOn(3, r, c, 2, 0.7), "a window lit stays lit as lit rises");

  const row = treeRow(elementAt({ type: "trees", x: 0.5, spread: 0.4, count: 7 }, 0));
  assert.equal(row.length, 7);
  assert.ok(row.every((p) => p.x > 0.29 && p.x < 0.71));
  assert.ok(row.every((p, i) => i === 0 || p.y >= row[i - 1].y), "far (higher) pines first");

  const frame = { W: 1920, H: 1080 };
  const tg = elementGeometry(town, frame);
  near(tg.box[0], 0.2, 1e-9);
  near(tg.box[3], town.y, 1e-9);
  near(tg.box[1], town.y - town.size, 1e-9);
  assert.ok(elementGeometry(elementAt({ type: "trees" }, 0), frame));
  assert.equal(elementGeometry(elementAt({ type: "hills" }, 0), frame), null);
  assert.equal(horizonAt([{ id: "h", type: "hills", y: 0.62 }], 0), 0.62);
  assert.equal(horizonAt([{ id: "h", type: "hills", y: 0.62 }, { id: "s", type: "sea", y: 0.7 }], 0), 0.7);

  const scenes = [{ id: "a", type: "tableau", props: { elements: [
    { id: "sky", type: "sky", tone: "dusk" }, { id: "hills", type: "hills", layers: 4, rough: 0.8, cap: 0.6 }, { id: "fog", type: "fog", y: 0.7 },
    { id: "town", type: "town", lit: 0, to: [{ at: 1, lit: 1, dur: 3 }] }, { id: "pines", type: "trees", count: 12, wind: 0.4 },
    { id: "birds", type: "birds", count: 6, speed: 0.04, facing: -1 }, { id: "snow", type: "snow", intensity: 0.8 },
  ] } }];
  assert.deepEqual(schemaGate("storyboard", { scenes }), []);
  assert.ok(schemaGate("storyboard", { scenes: [{ id: "x", type: "tableau", props: { elements: [{ id: "h", type: "hills", layers: 9 }] } }] }).length);
  near(elementAt({ ...scenes[0].props.elements[3], to: [{ t: 1, lit: 1, dur: 3 }] }, 2.5).lit, 0.5, 1e-9);
  const props = { elements: [{ id: "town", type: "town" }, { id: "pines", type: "trees" }], camera: [{ on: "town" }, { t: 2, on: ["town", "pines"] }] };
  const errors = [];
  resolveTableauRefs(props, { width: 1920, height: 1080 }, errors, 'scene "s"');
  assert.deepEqual(errors, []);
  assert.ok(props.camera[0].zoom > 1);
});

test("tableau refs: a piece on hills stands on a ridgeline at its x and keeps to it as it walks", () => {
  const hills = { id: "hills", type: "hills", layers: 3, rough: 0.6 };
  const els = [hills, { id: "w", type: "figure", x: 0.2, t: 0, on: "hills", to: [{ t: 2, x: 0.7, dur: 4 }] }, { id: "far", type: "fire", x: 0.6, on: "hills", anchor: "ridge0", dy: 0.01 }];
  const errors = [];
  resolveTableauRefs({ elements: els }, { width: 1920, height: 1080 }, errors, 'scene "s"');
  assert.deepEqual(errors, []);
  const s = elementAt(hills, 0), [w, far] = [els[1], els[2]];
  near(w.y, ridgeTop(s, 2, 0.2).y, 1e-3);
  near(w.depth, ridgeDepth(s, 2));
  assert.deepEqual(w.follow, { id: "hills", k: 2, dy: 0 });
  near(w.to[0].y, ridgeTop(s, 2, 0.7).y, 1e-3);
  assert.equal(w.on, undefined);
  for (const t of [2.5, 3.3, 4.1, 5]) {
    const st = stateAt(w, els, t);
    near(st.y, ridgeTop(s, 2, st.x).y, 1e-9);
  }
  near(far.y, ridgeTop(s, 0, 0.6).y + 0.01, 1e-3);
  near(far.depth, ridgeDepth(s, 0));
  assert.equal(stateAt({ id: "x", type: "figure", y: 0.5 }, els, 1).y, 0.5);
  const bad = (el) => { const e = []; resolveTableauRefs({ elements: [hills, el] }, { width: 1920, height: 1080 }, e, 'scene "s"'); return e.join("\n"); };
  assert.match(bad({ id: "f", type: "figure", on: "hills", anchor: "ridge5" }), /no anchor "ridge5" \(ridge = the nearest ridgeline, ridge0…ridge2/);
  assert.match(bad({ id: "f", type: "figure", on: "hills", anchor: "lamp" }), /no anchor "lamp"/);
});

test("tableau refs: elements stand on anchors, camera keys aim at elements, mistakes are errors", () => {
  const props = {
    elements: [
      { id: "sea", type: "sea" },
      { id: "lh", type: "lighthouse", x: 0.3 },
      { id: "keeper", type: "figure", on: "lh", anchor: "gallery", dx: 0.01 },
      { id: "boat", type: "boat", x: 0.75 },
    ],
    camera: [{ on: "lh" }, { t: 2, on: "keeper", anchor: "head", zoom: 2.5, place: [0.5, 0.4] }, { t: 5, on: ["lh", "boat"] }],
  };
  const errors = [];
  resolveTableauRefs(props, { width: 1920, height: 1080 }, errors, 'scene "s"');
  assert.deepEqual(errors, []);
  const lh = elementGeometry(elementAt(props.elements[1], 0), { W: 1920, H: 1080 });
  const keeper = props.elements[2];
  near(keeper.x, 0.31, 1e-3);
  near(keeper.y, lh.anchors.gallery[1], 1e-3);
  assert.equal(keeper.on, undefined);
  assert.equal(keeper.depth, lh.depth);
  const [whole, head, both] = props.camera;
  assert.ok(whole.zoom > 1 && whole.on === undefined);
  const hg = elementGeometry(elementAt(keeper, 0), { W: 1920, H: 1080 });
  const [hx, hy] = onScreen({ ...head, sway: 0 }, hg.depth, hg.anchors.head);
  near(hx, 0.5, 2e-3);
  near(hy, 0.4, 2e-3);
  assert.ok(both.zoom >= 1 && both.zoom < whole.zoom);

  const bad = (camera, elements = [{ id: "lh", type: "lighthouse" }, { id: "sky", type: "sky" }]) => {
    const e = [];
    resolveTableauRefs({ elements: structuredClone(elements), camera }, { width: 1920, height: 1080 }, e, 'scene "s"');
    return e.join("\n");
  };
  assert.match(bad([{ on: "ghost" }]), /not an element of this scene \(solid ones: lh\)/);
  assert.match(bad([{ on: "lh", x: 0.3 }]), /either on or x\/y/);
  assert.match(bad([{ on: "sky" }]), /no body to aim at/);
  assert.match(bad([{ on: "lh", anchor: "roof" }]), /no anchor "roof" \(center, top, base, gallery, lamp\)/);
  assert.match(bad([], [{ id: "a", type: "figure", on: "b" }, { id: "b", type: "figure", on: "a" }]), /loops back/);
});

test("same-world boundaries dissolve; a reframing transition there is flagged", () => {
  const sc = (type, inherit, extra = {}) => ({ type, durationInFrames: 300, props: inherit ? { inherit: true } : {}, ...extra });
  const theme = { transition: "zoom" };
  assert.equal(boundaryTransition(sc("tableau"), sc("tableau", true), theme, 30).type, "fade");
  assert.equal(boundaryTransition(sc("tableau"), sc("tableau"), theme, 30).type, "zoom");
  assert.equal(boundaryTransition(sc("tableau"), sc("tableau", true, { enter: "whip" }), theme, 30).type, "whip");
  const tl = (type) => ({
    width: 1920, height: 1080, fps: 30, theme: {},
    scenes: [
      { id: "a", type: "tableau", start: 0, duration: 4, props: { elements: [] }, shots: [] },
      { id: "b", type: "tableau", start: 4, duration: 4, props: { inherit: true, elements: [] }, shots: [], transitionIn: { type, frames: 12 } },
    ],
  });
  const hit = (type) => rhythmGate(tl(type), {}).filter((i) => /continues one world/.test(i.msg));
  assert.equal(hit("fade").length, 0);
  assert.equal(hit("zoom").length, 1);
});

test("framingGate: a solid element cut by the frame at rest is flagged unless crop", () => {
  const scene = (lh) => ({
    width: 1920, height: 1080,
    scenes: [{ id: "s", type: "tableau", start: 0, duration: 2, props: { elements: [{ id: "sea", type: "sea" }, lh], camera: [{ x: 0.5, y: 0.5, zoom: 1 }] } }],
  });
  assert.deepEqual(framingGate(scene({ id: "lh", type: "lighthouse", x: 0.4 }), {}), []);
  const cut = framingGate(scene({ id: "lh", type: "lighthouse", x: 0.4, y: 0.45, h: 0.6 }), {});
  assert.equal(cut.length, 1);
  assert.match(cut[0].msg, /lighthouse "lh" is cut by the frame edge at rest .*on: "lh"/);
  assert.equal(cut[0].at.field, "props.elements[1]");
  assert.deepEqual(framingGate(scene({ id: "lh", type: "lighthouse", x: 0.4, y: 0.5, h: 0.7, crop: true }), {}), []);
  // Too big to fit at this zoom (a close-up on something standing on it): the set, not a mistake.
  assert.deepEqual(framingGate(scene({ id: "lh", type: "lighthouse", x: 0.4, y: 0.95, h: 0.85 }), {}), []);
});

test("groundingGate: a piece set on a cliff's top but past its edge hangs over the sea", () => {
  const world = (els, more = []) => ({
    width: 1920, height: 1080,
    scenes: [
      { id: "a", type: "tableau", start: 0, duration: 1, props: { elements: [{ id: "sea", type: "sea" }, ...els], camera: [{ x: 0.5, y: 0.5, zoom: 1 }] } },
      ...more,
    ],
  });
  const cliff = { id: "cliff", type: "cliff", x: 0.27, y: 0.6 };
  // The keeper example's hut: x 0.31 with the rock ending at 0.27.
  const [w] = groundingGate(world([cliff, { id: "hut", type: "hut", x: 0.31, y: 0.6 }]));
  assert.match(w.msg, /hut "hut" stands past the cliff's edge \(x 0\.31, the rock ends at 0\.27\).*x 0\.234 puts it on the rock/);
  assert.equal(w.at.field, "props.elements[2]");
  assert.deepEqual(groundingGate(world([cliff, { id: "hut", type: "hut", x: 0.234, y: 0.6 }])), []);
  // On the shore (foot at the sea line, nearer depth) it is not on the cliff at all.
  assert.deepEqual(groundingGate(world([cliff, { id: "k", type: "figure", x: 0.5, y: 0.86 }])), []);
  // A right-hand cliff's rock runs the other way; a piece walking off it is caught when it gets there.
  const right = { id: "c2", type: "cliff", side: "right", x: 0.7, y: 0.6 };
  assert.deepEqual(groundingGate(world([right, { id: "lh", type: "lighthouse", x: 0.8, y: 0.6 }])), []);
  const walk = groundingGate(world([right, { id: "f", type: "figure", x: 0.8, y: 0.6, depth: 0.62, to: [{ t: 0.2, dur: 0.4, x: 0.6 }] }]));
  assert.equal(walk.length, 1);
  assert.ok(walk[0].at.from >= 0.4);
  // Reported once, where it first shows, not again in the inherit scene after.
  const twice = world([cliff, { id: "hut", type: "hut", x: 0.31, y: 0.6 }], [{ id: "b", type: "tableau", start: 1, duration: 1, props: { elements: [cliff, { id: "hut", type: "hut", x: 0.31, y: 0.6 }], camera: [{ x: 0.5, y: 0.5, zoom: 1 }] } }]);
  assert.equal(groundingGate(twice).length, 1);
  // The fix moves x where the storyboard set it: in the scene that defines the piece, even when it
  // first hangs over the sea in an inherit scene later; never for a piece keyframed in x or placed on another.
  const hut = { id: "hut", type: "hut", x: 0.31, y: 0.6 };
  const board = { scenes: [{ id: "a", type: "tableau", props: { elements: [{ id: "sea", type: "sea" }, cliff, hut] } }, { id: "b", type: "tableau", props: { inherit: true, elements: [] } }] };
  assert.deepEqual(groundingGate(world([cliff, hut]), {}, board)[0].fix, { scene: "a", path: ["props", "elements", 2, "x"], value: 0.234 });
  const later = world([cliff], [{ id: "b", type: "tableau", start: 1, duration: 1, props: { elements: [cliff, hut], camera: [{ x: 0.5, y: 0.5, zoom: 1 }] } }]);
  assert.deepEqual(groundingGate(later, {}, board)[0].fix.scene, "a");
  const moved = structuredClone(board);
  moved.scenes[1].props.elements.push({ id: "hut", to: [{ at: 0.5, x: 0.2 }] });
  assert.equal(groundingGate(world([cliff, hut]), {}, moved)[0].fix, undefined);
});

test("tableau stage: a frame narrower than 16:9 looks through a window on a 16:9 stage", () => {
  assert.deepEqual(stageOf(1920, 1080), { W: 1920, H: 1080, kx: 1 });
  assert.deepEqual(stageOf(1080, 1080), { W: 1080 * 0 + 1080 * STAGE_ASPECT, H: 1080, kx: STAGE_ASPECT });
  const { W, kx } = stageOf(1080, 1920);
  near(W, 1920 * STAGE_ASPECT, 1e-9);
  near(kx, W / 1080, 1e-9);
  // The same stage point sits kx times farther from the frame's centre across, the same up and down.
  const cam = { x: 0.5, y: 0.5, zoom: 1.2 };
  const [wx, wy] = onScreen(cam, 1, [0.6, 0.3]), [nx, ny] = onScreen(cam, 1, [0.6, 0.3], kx);
  near(nx - 0.5, (wx - 0.5) * kx, 1e-9);
  near(ny, wy, 1e-9);
  // cameraFor and zoomToFit take the window into account: the point lands where asked, the box fits across.
  const c = cameraFor([0.3, 0.6], 0.8, 1.4, [0.4, 0.5], kx);
  const [px] = onScreen({ ...c, zoom: 1.4 }, 0.8, [0.3, 0.6], kx);
  near(px, 0.4, 1e-9);
  const box = /** @type {[number, number, number, number]} */ ([0.4, 0.5, 0.5, 0.7]);
  const z = zoomToFit(box, 1, 0.9, kx), b = boxOnScreen({ ...cameraFor([0.45, 0.6], 1, z, [0.5, 0.5], kx), zoom: z }, 1, box, kx);
  assert.ok(b[2] - b[0] <= 0.9 + 1e-9 && b[0] >= 0 && b[2] <= 1, JSON.stringify(b));
});

test("tableau 9:16: hand-set camera keys slide onto the subject, nothing is cut, walkers stay in", async () => {
  const scene = {
    id: "s", type: "tableau",
    props: {
      elements: [{ id: "sea", type: "sea" }, { id: "lh", type: "lighthouse", x: 0.2 }, { id: "man", type: "figure", x: 0.66, y: 0.9, size: 0.3, to: [{ at: 1, dur: 4, x: 0.8 }] }],
      camera: [{ at: 0, x: 0.5, y: 0.6, zoom: 1.1 }],
    },
  };
  const script = { scenes: [{ id: "s", narration: "海边有一座灯塔，守塔的人每天傍晚沿着海岸走一圈。" }] };
  const tl = async (aspect) => {
    const config = { aspect, fps: 30 };
    return compileTimeline({ script, storyboard: { scenes: [structuredClone(scene)] }, timings: await estimatedTimings(script, config), config, root: ROOT });
  };
  const wide = await tl("16:9"), tall = await tl("9:16");
  assert.deepEqual(wide.errors, []);
  assert.deepEqual(tall.errors, []);
  // 16:9 keeps the key as written; the narrow frame moves it toward the figure (the most telling body).
  assert.equal(wide.timeline.scenes[0].props.camera[0].x, 0.5);
  const s = tall.timeline.scenes[0], k = s.props.camera[0];
  assert.ok(k.x > 0.5, String(k.x));
  const { kx } = stageOf(tall.timeline.width, tall.timeline.height);
  const man = s.props.elements.find((e) => e.id === "man");
  for (const t of [0, 2, 4, 6]) {
    const st = stateAt(man, s.props.elements, t);
    const g = elementGeometry(st, { W: tall.timeline.width, H: tall.timeline.height, horizon: horizonAt(s.props.elements, t) });
    const b = boxOnScreen(cameraAt(s.props.camera, t), g.depth, g.box, kx);
    assert.ok(b[0] >= 0 && b[2] <= 1, `t=${t} ${b}`);
  }
  assert.deepEqual(framingGate(tall.timeline, {}), []);
});

for (const name of ["keeper", "postman"]) {
  test(`${name} example: 9:16 compiles with nothing cut by the window`, async () => {
    const dir = join(ROOT, "examples", name), j = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
    const config = { ...j("onevideo.json"), aspect: "9:16" }, script = j("plan/script.json");
    const r = compileTimeline({ script, storyboard: j("plan/storyboard.json"), timings: await estimatedTimings(script, config), config, root: dir });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(framingGate(r.timeline, config).map((i) => i.msg), []);
  });
}
