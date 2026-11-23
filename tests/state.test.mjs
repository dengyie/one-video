import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveStage, previewOutdated, productsHash, reviewOutdated, reviewSubject, stageStatus } from "../cli/lib/core/state.mjs";

test("productsHash: missing or empty (dotfiles only) products are not done", () => {
  const root = mkdtempSync(join(tmpdir(), "ov-state-"));
  assert.equal(productsHash(root, ["out"]), null);
  mkdirSync(join(root, "out"));
  writeFileSync(join(root, "out", ".DS_Store"), "x");
  assert.equal(productsHash(root, ["out"]), null);
});

test("productsHash changes with content and ignores dotfiles", () => {
  const root = mkdtempSync(join(tmpdir(), "ov-state-"));
  mkdirSync(join(root, "out"));
  writeFileSync(join(root, "out", "a.mp4"), "1");
  const h1 = productsHash(root, ["out"]);
  writeFileSync(join(root, "out", ".DS_Store"), "junk");
  assert.equal(productsHash(root, ["out"]), h1);
  writeFileSync(join(root, "out", "a.mp4"), "2");
  assert.notEqual(productsHash(root, ["out"]), h1);
});

test("productsHash is independent of where the project lives", () => {
  const mk = () => {
    const root = mkdtempSync(join(tmpdir(), "ov-state-"));
    mkdirSync(join(root, "plan"));
    writeFileSync(join(root, "plan", "script.json"), "{}");
    return root;
  };
  assert.equal(productsHash(mk(), ["plan"]), productsHash(mk(), ["plan"]));
});

test("stageStatus expands {name} in products: stills alone do not complete render", () => {
  const root = mkdtempSync(join(tmpdir(), "ov-state-"));
  mkdirSync(join(root, "out", "stills"), { recursive: true });
  writeFileSync(join(root, "out", "stills", "01.jpg"), "x");
  const project = { root, config: { name: "demo" }, paths: { state: join(root, "state.json") } };
  const pipeline = { name: "p", stages: [{ id: "render", produces: ["out/{name}.mp4"] }] };
  assert.equal(stageStatus(project, pipeline)[0].status, "pending");
  writeFileSync(join(root, "out", "demo.mp4"), "v");
  assert.equal(stageStatus(project, pipeline)[0].status, "done");
});

test("stageStatus reads only approval products and detects same-size edits to them", (t) => {
  const root = mkdtempSync(join(tmpdir(), "ov-state-"));
  const project = { root, config: { name: "demo" }, paths: { state: join(root, "state.json") } };
  const pipeline = { name: "p", stages: [
    { id: "render", produces: ["render.mp4"] },
    { id: "script", produces: ["script.json"], approval: true },
    { id: "extras", produces: ["extras"] },
  ] };
  const render = join(root, "render.mp4"), script = join(root, "script.json");
  const read = fs.readFileSync;
  const spy = t.mock.method(fs, "readFileSync", (path, ...args) => {
    assert.notEqual(path, render, "status must not read the render bytes");
    return read(path, ...args);
  });
  syncBuiltinESMExports();
  try {
    writeFileSync(render, "video");
    writeFileSync(script, "[1]");
    mkdirSync(join(root, "extras"));
    writeFileSync(join(root, "extras", ".hidden"), "not an output");
    approveStage(project, pipeline, "script");
    assert.deepEqual(stageStatus(project, pipeline).map((stage) => stage.status), ["done", "approved", "pending"]);
    writeFileSync(script, "[2]");
    assert.equal(stageStatus(project, pipeline)[1].status, "stale");
  } finally {
    spy.mock.restore();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a QC review goes stale when the main render or the timeline changes", () => {
  const root = mkdtempSync(join(tmpdir(), "ov-state-"));
  mkdirSync(join(root, "out"));
  mkdirSync(join(root, "plan"));
  const project = { root, config: { name: "demo" }, paths: { state: join(root, "state.json") } };
  assert.equal(reviewOutdated(project), null);
  writeFileSync(join(root, "plan", "timeline.json"), "{}");
  writeFileSync(join(root, "out", "demo.mp4"), "v1");
  writeFileSync(join(root, "plan", "review.json"), JSON.stringify({ subject: reviewSubject(project) }));
  assert.equal(reviewOutdated(project), null);
  writeFileSync(join(root, "plan", "timeline.json"), '{"duration": 2}');
  assert.match(reviewOutdated(project), /timeline\.json changed after QC/);
  writeFileSync(join(root, "plan", "review.json"), JSON.stringify({ subject: reviewSubject(project) }));
  writeFileSync(join(root, "out", "demo.mp4"), "v2 longer");
  assert.match(reviewOutdated(project), /rendered again after QC/);
  writeFileSync(join(root, "plan", "review.json"), JSON.stringify({ issues: [] }));
  assert.match(reviewOutdated(project), /does not record which render/);
});

test("an approved preview goes stale when the timeline compiles differently", () => {
  const root = mkdtempSync(join(tmpdir(), "ov-state-"));
  mkdirSync(join(root, "plan"));
  const project = { root, config: { name: "demo" }, paths: { state: join(root, "state.json") } };
  const pipeline = { name: "p", stages: [{ id: "preview", produces: ["plan/preview.json"], approval: true }] };
  writeFileSync(join(root, "plan", "timeline.json"), "{}");
  assert.equal(stageStatus(project, pipeline)[0].status, "pending");
  writeFileSync(join(root, "plan", "preview.json"), JSON.stringify({ timeline: productsHash(root, ["plan/timeline.json"]) }));
  assert.equal(stageStatus(project, pipeline)[0].status, "awaiting-approval");
  approveStage(project, pipeline, "preview");
  assert.equal(stageStatus(project, pipeline)[0].status, "approved");
  writeFileSync(join(root, "plan", "timeline.json"), '{"duration": 2}');
  assert.match(previewOutdated(project), /changed after the preview/);
  assert.equal(stageStatus(project, pipeline)[0].status, "stale");
  assert.throws(() => approveStage(project, pipeline, "preview"), /onevideo preview/);
});

test("fiction: research is optional and numbersGate stays quiet without it", async () => {
  const { numbersGate } = await import("../cli/lib/review/gates.mjs");
  const root = mkdtempSync(join(tmpdir(), "ov-fiction-"));
  const pipeline = { stages: [{ id: "research", produces: ["plan/research.json"], approval: true }, { id: "proposal", produces: ["plan/proposal.md"], approval: true }] };
  const project = (config) => ({ root, config, paths: { state: join(root, "plan", "state.json") } });
  assert.equal(stageStatus(project({}), pipeline)[0].status, "pending");
  assert.equal(stageStatus(project({ fiction: true }), pipeline)[0].status, "optional");
  const script = { scenes: [{ id: "a", narration: "三百年前，一座灯塔。" }] };
  assert.equal(numbersGate(script, null, {}).length, 1);
  assert.deepEqual(numbersGate(script, null, { fiction: true }), []);
});
