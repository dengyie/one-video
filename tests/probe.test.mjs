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

test("probeIssues moves an anchored overlay by its offset, in layout units", () => {
  const t = tl();
  Object.assign(t.scenes[0].overlays[0], { on: "card1", offset: [0, 20] });
  const [w] = probeIssues(shot([{ i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [{ t: 0, area: 0.004 }] }], [title]), t);
  assert.equal(w.fix.set.offset[0], 0);
  // 1u = 1px at 1080 wide: a move of dy of the 1920 frame is dy * 1920 units.
  const dy = (w.fix.set.offset[1] - 20) / 1920;
  assert.ok(Math.abs(dy) >= 0.04 && Math.abs(dy) <= 0.09, String(dy));
  assert.match(w.msg, /move it to offset \[0, -?\d+\]/);
});

test("probe fixes: the main cut moves the overlay, a variant writes only its own aspects entry", async () => {
  const { applyFix } = await import("../cli/lib/review/fixes.mjs");
  const rec = { i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [{ t: 0, area: 0.004 }] };
  const [main] = probeIssues(shot([rec], [title]), tl());
  assert.deepEqual(main.fix.path, ["overlays", 0]);
  const [v] = probeIssues(shot([rec], [title]), tl(), { variant: "9:16" });
  assert.match(v.msg, / in 9:16 \(onevideo fix\)/);
  const y = v.fix.set["9:16"].y;
  const sb = { scenes: [{ id: "s", overlays: [{ type: "stamp", y: 0.5, aspects: { "9:16": { x: 0.3 } } }] }] };
  assert.ok(applyFix(sb, v.fix));
  assert.deepEqual(sb.scenes[0].overlays[0], { type: "stamp", y: 0.5, aspects: { "9:16": { x: 0.3, y } } });
  const bare = { scenes: [{ id: "s", overlays: [{ type: "stamp", y: 0.5 }] }] };
  assert.ok(applyFix(bare, v.fix));
  assert.deepEqual(bare.scenes[0].overlays[0].aspects, { "9:16": { y } });
});

test("probe spots move sideways when no height clears the text, and keep off other stickers", () => {
  // Lines down the whole left half (a long list): only the right half is clear.
  const column = Array.from({ length: 18 }, (_, k) => ({ text: `行${k}`, box: [0.05, 0.05 + k * 0.05, 0.55, 0.08 + k * 0.05] }));
  const rec = { i: 0, box: [0.3, 0.4, 0.5, 0.5], covers: [{ t: 7, area: 0.004 }] };
  const [side] = probeIssues(shot([rec], column), tl());
  assert.deepEqual(side.fix.set, { x: 0.75 });
  assert.match(side.msg, /move it to x 0\.75 \(onevideo fix\)/);
  // A second sticker sits just above the stamp: the clear height below is taken instead.
  const t = tl();
  t.scenes[0].overlays.push({ type: "icon", t: 1, end: 5 });
  const [below] = probeIssues(shot([{ i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [{ t: 0, area: 0.004 }] }, { i: 1, box: [0.3, 0.3, 0.7, 0.44], covers: [] }], [title]), t);
  assert.ok(below.fix.set.y > 0.5, JSON.stringify(below.fix.set));
});
