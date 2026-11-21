import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  KIND_NAMES, PALETTES, bandDepth, bandFor, cameraAt, cameraMoving, elementAt, flashAt, flashTotal, lampLevel, layerView,
  mixHex, paletteAt, settledElement, tableauTimes, waveY, SEA_BANDS,
} from "../shared/tableau.mjs";
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
