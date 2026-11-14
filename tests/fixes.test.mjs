import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFix, describeFix, fixPlan } from "../cli/lib/review/fixes.mjs";
import { numberReveals } from "../cli/lib/review/reveals.mjs";
import { example } from "./helpers.mjs";

test("applyFix: merges into the storyboard object or replaces a value; unknown targets are left alone", () => {
  const sb = { scenes: [{ id: "a", cues: { quit: "辞去" }, overlays: [{ type: "stamp", text: "x", y: 0.9 }] }] };
  assert.deepEqual(applyFix(sb, { scene: "a", path: ["overlays", 0], set: { y: 0.7 } }), { y: { from: 0.9, to: 0.7 } });
  assert.deepEqual(applyFix(sb, { scene: "a", path: ["cues", "quit"], value: "2026年" }), { quit: { from: "辞去", to: "2026年" } });
  assert.deepEqual(sb.scenes[0], { id: "a", cues: { quit: "2026年" }, overlays: [{ type: "stamp", text: "x", y: 0.7 }] });
  assert.equal(applyFix(sb, { scene: "a", path: ["overlays", 3], set: { y: 0.7 } }), null);
  assert.equal(applyFix(sb, { scene: "a", path: ["cues", "nope"], value: "x" }), null);
  assert.equal(applyFix(sb, { scene: "zz", path: ["cues", "quit"], value: "x" }), null);
  assert.deepEqual(applyFix(sb, { scene: "a", path: ["shots"], value: "auto", add: true }), { shots: { from: undefined, to: "auto" } });
  assert.equal(sb.scenes[0].shots, "auto");
});

test("fixPlan: stickers dropped on the captions move clear of them and of each other, a still title gets a shot track, charts keep their cue warnings", () => {
  const ex = example({ media: ["sfx/whoosh.wav", "sfx/pop.wav", "music/inspired.mp3"] });
  const storyboard = structuredClone(ex.storyboard);
  const profit = storyboard.scenes.find((s) => s.id === "profit");
  delete profit.props.left.cue;
  delete profit.props.right.cue;
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
  assert.deepEqual(check.issues.filter((i) => i.gate === "rhythm" && i.fix), [], "scenes with no shot track got the auto one");
  assert.equal(storyboard.scenes[0].shots, "auto", "the title opening is pushed into");
  assert.equal(storyboard.scenes[1].shots, undefined, "the stat cards are not: their stretch wants a cue");
  assert.ok(check.issues.some((i) => i.gate === "rhythm" && /cue a reveal/.test(i.msg)));
  const v = storyboard.scenes.find((s) => s.id === "valuation");
  assert.deepEqual([v.props.pointCues, v.cues.n1], [["n1", "n2", "n3", "n4"], "3500亿"], "the line is drawn to each value as it is said");
  assert.deepEqual([profit.props.left.cue, profit.props.right.cue, Object.keys(profit.cues)], ["left", "right", ["left", "right"]], "the cues already written are used, no new ones made up");
  assert.match(describeFix(applied.find((a) => a.gate === "layout")), new RegExp(`^${storyboard.scenes[1].id} overlays\\[\\d\\]: y 0\\.9\\d? → 0\\.\\d+$`));
  assert.equal(ex.storyboard.scenes[1].overlays, undefined, "the original is untouched");
});

test("numberReveals: chart values the narration says get a cue on those words; dates, cued elements and unsaid values do not", () => {
  const lines = [{ start: 0, end: 4, text: "2024年12月约3500亿美元，" }, { start: 4, end: 8, text: "一年后约8000亿，再到1.25万亿。" }];
  const line = numberReveals({ type: "line-chart", lines, cues: { n1: 1 }, props: { series: [{ points: [["2024.12", 3.5e11], ["2025.06", 6e11], ["2025.12", 8e11], ["2026.02", 1.25e12]] }] } });
  assert.deepEqual(line.cues, { n2: "3500亿", n3: "8000亿", n4: "1.25万亿" });
  assert.deepEqual(line.refs, [{ path: ["props", "pointCues"], value: ["n2", null, "n3", "n4"] }]);
  assert.ok(line.times[0] > 1 && line.times[0] < 4 && line.times[1] > 4);
  const said = [{ start: 0, end: 4, text: "利润约44亿美元，但净亏损约49亿。" }];
  const cmp = numberReveals({ type: "compare", lines: said, cues: { left: 0.4 }, props: { left: { value: 4.4e9, cue: "left" }, right: { value: -4.9e9 } } });
  assert.deepEqual([cmp.cues, cmp.refs], [{ n1: "49亿" }, [{ path: ["props", "right", "cue"], value: "n1" }]]);
  const share = numberReveals({ type: "share", lines: [{ start: 0, end: 3, text: "收入约187亿美元，连接约114亿" }], props: { segments: [{ value: 1.14e10, cue: "c" }, { value: 4.1e9 }, { value: 3.2e9 }] } });
  assert.deepEqual(share.refs, [{ path: ["props", "total"], value: { label: "合计", cue: "n1" } }]);
  assert.equal(numberReveals({ type: "stat-cards", lines: [{ start: 0, end: 2, text: "2025年开始" }], props: { cards: [{ value: 2025 }] } }), null);
  assert.equal(numberReveals({ type: "kinetic", lines, props: { lines: [] } }), null);
});

test("applyFix: a fix `with` more changes applies all of them or none", () => {
  const sb = { scenes: [{ id: "v", props: { series: [] } }] };
  const fix = { scene: "v", path: ["cues"], set: { n1: "3500亿" }, add: true, with: [{ path: ["props", "pointCues"], value: ["n1"] }] };
  assert.deepEqual(applyFix(sb, fix), { n1: { from: undefined, to: "3500亿" }, "props.pointCues": { from: undefined, to: ["n1"] } });
  assert.deepEqual(sb.scenes[0], { id: "v", cues: { n1: "3500亿" }, props: { series: [], pointCues: ["n1"] } });
  assert.equal(applyFix(sb, { ...fix, with: [{ path: ["nope", "x"], value: 1 }] }), null);
  assert.deepEqual(sb.scenes[0].cues, { n1: "3500亿" }, "nothing half-applied");
});
