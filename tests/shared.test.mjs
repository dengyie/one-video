import { test } from "node:test";
import assert from "node:assert/strict";
import { captionAt, captionWindows } from "../shared/caption-timing.mjs";
import { closingFade } from "../shared/transition.mjs";
import { musicVolumeProps } from "../shared/music-envelope.mjs";
import { rightShotInset } from "../shared/camera.mjs";
import {
  area, cameraMoving, captionBand, clampView, clearOf, cueOr, easeOut, inFrame, labelWidth, LABEL_H, mapViewAt,
  meets, overlap, paceOf, placePinLabels, revealAt, seenBox, seenSpan, textEms, viewAt, visibleOnGlobe, WIDE,
} from "../shared/index.mjs";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("caption timing: short gaps and overlaps switch at speech onset without opacity drops", () => {
  const a = { text: "山梁", start: 5.083, end: 9.133 };
  const b = { text: "走进镇子", start: 9.383, end: 10.333 };
  const c = { text: "冬天", start: 10.2, end: 10.8 };
  const windows = captionWindows([c, a, b]);
  assert.deepEqual(captionAt(windows, 9.333), { item: a, fadeIn: 1, opacity: 1 });
  assert.deepEqual(captionAt(windows, b.start), { item: b, fadeIn: 1, opacity: 1 });
  assert.deepEqual(captionAt(windows, c.start), { item: c, fadeIn: 1, opacity: 1 });
  assert.equal(captionAt(windows, 11.1), undefined);
});

test("caption timing: isolated lines fade in and out; expired lines do not reappear", () => {
  const a = { start: 1, end: 4 }, b = { start: 2, end: 2.5 }, c = { start: 5, end: 6 };
  const windows = captionWindows([a, b, c]);
  assert.equal(captionAt(windows, 0.94), undefined);
  near(captionAt(windows, 1.01).opacity, 0.5);
  near(captionAt(windows, 2.69).opacity, 0.5);
  assert.equal(captionAt(windows, 3), undefined);
  near(captionAt(windows, 5.01).opacity, 0.5);
  near(captionAt(windows, 6.19).opacity, 0.5);
});

test("closing fade covers the visual on the last encoded frame", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((frame) => closingFade(frame, 5)), [0, 0.0625, 0.5, 0.9375, 1]);
  assert.equal(closingFade(0, 1), 1);
});

test("music envelope extends across loops, ducks under later speech and fades at the end of the cut", () => {
  const { loopVolumeCurveBehavior, volume } = musicVolumeProps(30, 12, { volume: 0.3, duckTo: 0.1, fade: 1 }, [[1, 2], [7, 8]]);
  assert.equal(loopVolumeCurveBehavior, "extend");
  assert.equal(volume(0), 0);
  near(volume(5 * 30), 0.3);
  near(volume(6.8 * 30), 0.1 + 0.2 * 0.2 / 0.35);
  near(volume(7.5 * 30), 0.1);
  near(volume(11.5 * 30), 0.15);
  assert.equal(volume(12 * 30), 0);
});

test("boxes: meets is strict, overlap is the shared area", () => {
  assert.equal(meets([0, 0, 1, 1], [1, 0, 2, 1]), false);
  assert.equal(meets([0, 0, 1, 1], [0.5, 0.5, 2, 2]), true);
  near(overlap([0, 0, 1, 1], [0.5, 0.5, 2, 2]), 0.25);
  assert.equal(area([1, 1, 0, 0]), 0);
});

test("camera: a push-in never shows past the layer edge, and holds once it lands", () => {
  assert.deepEqual(viewAt(undefined, 3), WIDE);
  assert.deepEqual(clampView({ zoom: 2, x: 0.9, y: 0.1, rotate: 0 }), { zoom: 2, x: 0.75, y: 0.25, rotate: 0 });
  // zoom < 1 shows the edge by design: left alone.
  assert.deepEqual(clampView({ zoom: 0.8, x: 0.9, y: 0.1, rotate: 0 }), { zoom: 0.8, x: 0.9, y: 0.1, rotate: 0 });
  const shots = [{ t: 0, zoom: 1 }, { t: 1, zoom: 2, x: 1, y: 0.5, ease: 1 }];
  assert.equal(viewAt(shots, 0.5).zoom, 1);
  const end = viewAt(shots, 2.5);
  assert.equal(end.zoom, 2);
  assert.equal(end.x, 0.75);
  assert.equal(cameraMoving(shots, 0.5), false);
  assert.equal(cameraMoving(shots, 1.4), true);
  assert.equal(cameraMoving(shots, 2.5), false);
  // A cut jumps: moving only on the frame it lands.
  const cut = [{ t: 0 }, { t: 1, zoom: 1.5, cut: true }];
  assert.equal(viewAt(cut, 1).zoom, 1.5);
  assert.equal(cameraMoving(cut, 1.2), false);
});

test("camera: seenSpan and seenBox keep only what stays on screen through the window", () => {
  assert.deepEqual(seenSpan(undefined, 0, 4), [0, 1]);
  const shots = [{ t: 0, zoom: 2, x: 0.25, cut: true }, { t: 2, zoom: 2, x: 0.75, cut: true }];
  assert.deepEqual(seenSpan(shots, 0, 1), [0, 0.5]);
  // Across the cut nothing is on screen the whole time.
  const [l, r] = seenSpan(shots, 0, 3);
  assert.ok(r <= l);
  assert.deepEqual(seenBox(shots, 0, 1), [0, 0.25, 0.5, 0.75]);
  assert.deepEqual(seenBox(undefined, 0, 1), [0, 0, 1, 1]);
});

test("camera: the caption band maps back through a push-in", () => {
  assert.deepEqual(captionBand(undefined, 0), [0.2, 0.84, 0.8, 0.96]);
  assert.deepEqual(captionBand(undefined, 0, true), [0.2, 0.74, 0.8, 0.86]);
  const [x0, y0, x1, y1] = captionBand([{ t: 0, zoom: 2, cut: true }], 0);
  near(x0, 0.35); near(x1, 0.65); near(y0, 0.67); near(y1, 0.73);
});

test("the scale comparison ratio keeps its right margin through a late push-in", () => {
  const shots = [{ t: 0, zoom: 1 }, { t: 4.15, zoom: 1.1, ease: 1.6 }];
  for (const width of [1920, 1080]) {
    const margin = 96;
    assert.equal(rightShotInset(undefined, 5, 7.7, width, margin), margin);
    const inset = rightShotInset(shots, 5, 7.7, width, margin);
    assert.ok(inset > margin);
    for (const t of [5, 5.5, 6, 7.7]) {
      const { zoom, x } = viewAt(shots, t);
      const edge = width / 2 + zoom * (width - inset - x * width);
      assert.ok(edge <= width - margin);
    }
  }
});

test("labels: text width counts CJK as 1em, the rest as 0.6em", () => {
  assert.equal(textEms("上海"), 2);
  near(textEms("ab"), 1.2);
  near(labelWidth("上海ab"), (2 + 1.2) * 28 + 36);
  // Kept inside a span with a 24u margin either side.
  assert.equal(inFrame(0, 100, [0, 1000], 1), 74);
  assert.equal(inFrame(1000, 100, [0, 1000], 1), 926);
  assert.equal(inFrame(500, 100, [0, 1000], 1), 500);
});

test("labels: clearOf steps a label clear of placed ones and records only a visible one", () => {
  const placed = [[0, 0, 100, 50]];
  const [x, y] = clearOf(placed, 50, 25, 100, 50, 1, 1);
  assert.equal(x, 50);
  assert.equal(y, 25 + 56);
  assert.equal(placed.length, 2);
  clearOf(placed, 500, 500, 100, 50, -1, 1, 0);
  assert.equal(placed.length, 2);
});

test("labels: a pin label goes right, flips left at the frame edge or on a clash, then steps down", () => {
  const h = LABEL_H, w = labelWidth("东京");
  const [a] = placePinLabels([{ x: 100, y: 300, text: "东京", o: 1 }], 1, [0, 1920]);
  assert.equal(a.x, 122);
  near(a.y, 300 - 26);
  // Near the right edge: flips to the left of the pin.
  const [b] = placePinLabels([{ x: 1900, y: 300, text: "东京", o: 1 }], 1, [0, 1920]);
  assert.equal(b.x, 1900 - 22 - w);
  // Two pins at the same spot: the second flips left of its pin.
  const [, d] = placePinLabels([{ x: 500, y: 300, text: "东京", o: 1 }, { x: 500, y: 300, text: "羽田", o: 1 }], 1, [0, 1920]);
  assert.equal(d.x, 500 - 22 - labelWidth("羽田"));
  // Hidden or missing items take no room.
  assert.deepEqual(placePinLabels([null, { x: 1, y: 1, text: "x", o: 0 }], 1, [0, 1920]), []);
  assert.ok(h > 0);
});

test("labels: globe visibility and the map camera's flight between views", () => {
  assert.equal(visibleOnGlobe([105, 25], [105, 25]), true);
  assert.equal(visibleOnGlobe([-75, -25], [105, 25]), false);
  const views = [{ center: [170, 0], zoom: 1 }, { center: [-170, 10], zoom: 4 }];
  const starts = [0, 3];
  assert.deepEqual(mapViewAt(views, starts, 0, 1), { center: [170, 0], zoom: 1 });
  const end = mapViewAt(views, starts, 3, 1);
  // Shortest way round: across the date line, not back through 0°.
  near(end.center[0], 190); near(end.center[1], 10); near(end.zoom, 4);
  const mid = mapViewAt(views, starts, 2.5, 1);
  near(mid.zoom, 2, 1e-9); // log-space halfway between 1 and 4
});

test("reveal: a named cue wins, else the stagger across the scene's first 55%", () => {
  const sc = { duration: 10, cues: { b: 4.2, none: null } };
  assert.equal(paceOf("fast"), 0.7);
  assert.equal(paceOf("nope"), 1);
  assert.equal(revealAt(sc, 1, 0, 3, "b"), 4.2);
  near(revealAt(sc, 1, 0, 3), 0.35);
  near(revealAt(sc, 1, 2, 3), 4.2);
  near(revealAt(sc, 1, 0, 1, "none"), 0.35);
  assert.equal(cueOr(sc, "b", 9), 4.2);
  assert.equal(cueOr(sc, "none", 9), 9);
  assert.equal(cueOr(sc, undefined, 9), 9);
  assert.equal(easeOut(-1), 0);
  assert.equal(easeOut(2), 1);
});
