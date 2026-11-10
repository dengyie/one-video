import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProject } from "../cli/lib/core/project.mjs";
import { buildHandoff, handoffPath, manualSections } from "../cli/lib/publish/handoff.mjs";
import { example } from "./helpers.mjs";

function project() {
  const ex = example();
  const w = (f, v) => writeFileSync(join(ex.root, f), JSON.stringify(v));
  mkdirSync(join(ex.root, "plan"), { recursive: true });
  mkdirSync(join(ex.root, "out", "qc"), { recursive: true });
  w("onevideo.json", { ...ex.config, name: "demo", tts: { ...ex.config.tts, keyEnv: "SECRET_ENV" } });
  w("state.json", { stages: {} });
  for (const k of ["script", "storyboard", "research"]) w(`plan/${k}.json`, ex[k]);
  const items = ex.fetchedAssets.items.map((a, i) => (i === 0 ? { ...a, kind: "video", via: "generated", inspect: { model: "eyes", score: 7, issues: [{ t: 1.2, issue: "手部变形" }], kept: [1.5, 3] } } : a));
  w("plan/assets.json", { items });
  w("out/renders.json", { renders: [
    { v: 1, file: "out/versions/v1-draft.mp4", at: "2026-11-07T10:00:00.000Z", draft: true, part: false, offset: 0, frames: [0, 99], timeline: "aaa", pruned: true },
    { v: 2, file: "out/versions/v2-draft-part.mp4", at: "2026-11-07T11:00:00.000Z", draft: true, part: true, offset: 12, frames: [360, 809], scenes: ["race"], timeline: "bbb", note: "收紧开场" },
  ] });
  w("out/qc/look.json", { at: "2026-11-07T11:05:00.000Z", video: "out/versions/v2-draft-part.mp4", score: 6, notes: [{ t: 3, scene: "race", severity: "low", issue: "低", fix: "" }, { t: 5, scene: "race", severity: "high", issue: "字撞在一起", fix: "下移标题" }] });
  return loadProject(ex.root);
}

test("handoff: facts from the project, no secrets", () => {
  const p = project();
  const md = buildHandoff(p, { now: new Date("2026-11-07T12:00:00Z") });
  assert.match(md, /^# 交接：/);
  assert.match(md, /## 锁定（不要改）\n\n（空）/);
  assert.match(md, /◐ research awaiting-approval|● research done/);
  assert.match(md, /配音：/);
  assert.doesNotMatch(md, /SECRET_ENV/);
  assert.match(md, /\| generated \|  \| 7\/10 保留 1.5s\+3s；手部变形 \|/);
  assert.match(md, /\| v2 \| 2026-11-0\d \d\d:00 \| draft\+part \| 12s 起 \(race\) \| bbb \| 收紧开场 \|/);
  assert.match(md, /\| v1（已清理） \|/);
  assert.match(md, /onevideo sheet --vs v1/);
  // High-severity look notes first.
  assert.ok(md.indexOf("字撞在一起") < md.indexOf("[low]"));
  assert.match(md, /## 待处理\n\n- /);
});

test("handoff keeps the hand-written sections; --lock appends once, --next replaces", () => {
  const p = project();
  writeFileSync(handoffPath(p), buildHandoff(p, { lock: "配音 voice 定了" }).replace("## 备注\n\n（空）", "## 备注\n\n用户喜欢慢一点的开场\n第二行"));
  let md = buildHandoff(p, { lock: "配音 voice 定了", next: "只改 race 的转场" });
  writeFileSync(handoffPath(p), md);
  md = buildHandoff(p, { lock: "音乐 pulse", next: "只改 landing 的停留" });
  const m = manualSections(md);
  assert.equal(m["锁定（不要改）"], "- 配音 voice 定了\n- 音乐 pulse");
  assert.equal(m["下一轮只改"], "- 只改 landing 的停留");
  assert.equal(m["备注"], "用户喜欢慢一点的开场\n第二行");
  assert.equal(manualSections("## 阶段\n\nx\n## 备注\n\n（空）\n")["备注"], undefined);
});
