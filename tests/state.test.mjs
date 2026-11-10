import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productsHash, stageStatus } from "../cli/lib/core/state.mjs";

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
