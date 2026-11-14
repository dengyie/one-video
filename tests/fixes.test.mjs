import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFix, describeFix, fixPlan } from "../cli/lib/review/fixes.mjs";
import { example } from "./helpers.mjs";

test("applyFix: merges into the storyboard object or replaces a value; unknown targets are left alone", () => {
  const sb = { scenes: [{ id: "a", cues: { quit: "辞去" }, overlays: [{ type: "stamp", text: "x", y: 0.9 }] }] };
  assert.deepEqual(applyFix(sb, { scene: "a", path: ["overlays", 0], set: { y: 0.7 } }), { y: { from: 0.9, to: 0.7 } });
  assert.deepEqual(applyFix(sb, { scene: "a", path: ["cues", "quit"], value: "2026年" }), { quit: { from: "辞去", to: "2026年" } });
  assert.deepEqual(sb.scenes[0], { id: "a", cues: { quit: "2026年" }, overlays: [{ type: "stamp", text: "x", y: 0.7 }] });
  assert.equal(applyFix(sb, { scene: "a", path: ["overlays", 3], set: { y: 0.7 } }), null);
  assert.equal(applyFix(sb, { scene: "a", path: ["cues", "nope"], value: "x" }), null);
  assert.equal(applyFix(sb, { scene: "zz", path: ["cues", "quit"], value: "x" }), null);
});

test("fixPlan: stickers dropped on the captions move clear of them and of each other, and the gates pass", () => {
  const ex = example({ media: ["sfx/whoosh.wav", "sfx/pop.wav", "music/inspired.mp3"] });
  const storyboard = structuredClone(ex.storyboard);
  storyboard.scenes[1] = { ...storyboard.scenes[1], overlays: [
    { type: "stamp", text: "调查", at: 0.2, x: 0.5, y: 0.9 }, { type: "stamp", text: "进行中", at: 0.2, x: 0.5, y: 0.92 },
  ] };
  const project = { root: ex.root, config: ex.config, paths: {} };
  const plan = { script: ex.script, storyboard, research: ex.research, timings: ex.timings, assets: ex.fetchedAssets };
  const { applied, check } = fixPlan(project, plan);
  assert.ok(applied.length >= 2);
  assert.deepEqual(check.issues.filter((i) => i.gate === "layout").map((i) => i.msg), []);
  const [a, b] = storyboard.scenes[1].overlays;
  assert.ok(a.y < 0.8 && b.y < 0.8 && a.y !== b.y);
  assert.match(describeFix(applied[0]), new RegExp(`^${storyboard.scenes[1].id} overlays\\[\\d\\]: y 0\\.9\\d? → 0\\.\\d+$`));
  assert.equal(ex.storyboard.scenes[1].overlays, undefined, "the original is untouched");
});
