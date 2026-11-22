import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  KIND_NAMES, PALETTES, bandDepth, bandFor, cameraAt, cameraMoving, elementAt, flashAt, flashTotal, lampLevel, layerView,
  mixHex, paletteAt, settledElement, tableauTimes, waveY, SEA_BANDS,
  boxOnScreen, cameraFor, elementGeometry, insideShare, onScreen, zoomToFit,
} from "../shared/tableau.mjs";
import { resolveTableauRefs, boundaryTransition } from "../cli/lib/timeline/index.mjs";
import { framingGate, rhythmGate } from "../cli/lib/review/gates.mjs";
import { compileTimeline } from "../cli/lib/timeline/index.mjs";
import { schemaGate } from "../cli/lib/review/gates.mjs";
import { beatsFile, gridBeats } from "../cli/lib/audio/beats.mjs";
import { example } from "./helpers.mjs";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

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
