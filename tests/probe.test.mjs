import { test } from "node:test";
import assert from "node:assert/strict";
import { probeIssues } from "../cli/lib/review/probe.mjs";

// A 9:16 timeline with one scene and a stamp at y 0.5; probes are what Overlay.tsx probeBoxes logs.
const tl = () => ({
  width: 1080, height: 1920, fps: 30,
  scenes: [{ id: "s", start: 10, duration: 6, overlays: [{ type: "stamp", text: "史上最大", t: 1, end: 5, y: 0.5 }] }],
});
const shot = (overlays, texts) => [{ frame: 0, file: "x.jpg", scenes: [{ scene: "s", t: 2, overlays, texts }] }];
const title = { text: "募资", box: [0.2, 0.45, 0.8, 0.48] };

test("probeIssues flags a sticker hiding a line and finds a clear height", () => {
  const out = probeIssues(shot([{ i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [{ t: 0, area: 0.004 }] }], [title]), tl());
  assert.equal(out.length, 1);
  assert.equal(out[0].gate, "probe");
  assert.match(out[0].msg, /scene "s" overlay 0 \(stamp "史上最大"\) covers "募资" at 12\.0s — move it to y 0\.\d+/);
  assert.deepEqual(out[0].at, { scene: "s", from: 11, to: 15, field: "overlays[0]" });
  const y = Number(out[0].msg.match(/y (0\.\d+)/)[1]);
  assert.ok(y <= 0.47 || y >= 0.54, `y ${y} still meets the line`);
});

test("probeIssues trusts hit-tested coverage over the bounding box", () => {
  // The tilted stamp's box overlaps the line, but its drawn shape hides only a sliver.
  assert.deepEqual(probeIssues(shot([{ i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [{ t: 0, area: 0.0001 }] }], [title]), tl()), []);
  assert.deepEqual(probeIssues(shot([{ i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [] }], [title]), tl()), []);
  // Without measured coverage the box overlap decides.
  assert.equal(probeIssues(shot([{ i: 0, box: [0.3, 0.44, 0.7, 0.52] }], [title]), tl()).length, 1);
});

test("probeIssues says each pair once and ignores unknown scenes and overlays", () => {
  const rec = { i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [{ t: 0, area: 0.004 }] };
  const probes = [...shot([rec], [title]), ...shot([rec], [title]), { frame: 1, scenes: [{ scene: "zz", t: 0, overlays: [rec], texts: [title] }] }];
  assert.equal(probeIssues(probes, tl()).length, 1);
  assert.deepEqual(probeIssues(shot([{ ...rec, i: 3 }], [title]), tl()), []);
});

test("probeIssues leaves anchored overlays' height alone", () => {
  const t = tl();
  t.scenes[0].overlays[0].on = "title";
  const [w] = probeIssues(shot([{ i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [{ t: 0, area: 0.004 }] }], [title]), t);
  assert.match(w.msg, /move it clear of the text or show it at another moment/);
});
