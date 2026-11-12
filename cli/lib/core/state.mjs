// Stage state: a stage is "done" when its products exist, "approved" when a human signed off
// on the exact product contents (hash recorded), and "stale" when products changed after approval.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { UserError, readJson, writeJson } from "./project.mjs";

// Paths enter the hash relative to the project root, so a moved or copied project keeps its approvals.
function hashPath(root, path, h) {
  if (!existsSync(path)) return false;
  if (statSync(path).isDirectory()) {
    // An empty directory (e.g. a fresh out/) is not a product yet.
    const files = readdirSync(path).filter((f) => !f.startsWith(".")).sort();
    if (!files.length) return false;
    for (const f of files) hashPath(root, join(path, f), h);
  } else h.update(relative(root, path).split("\\").join("/")).update(readFileSync(path));
  return true;
}

export function productsHash(root, products) {
  const h = createHash("sha1");
  for (const p of products) if (!hashPath(root, join(root, p), h)) return null;
  return h.digest("hex").slice(0, 16);
}

// Pipeline products may name the project's video: "out/{name}.mp4".
export const stageProducts = (project, stage) => (stage.produces ?? []).map((p) => p.replaceAll("{name}", project.config.name));

// The QC report (plan/review.json) is about one render, not about its own bytes: it records the
// main cut it checked (size + mtime; hashing a long render on every status call is too slow) and
// the timeline it checked against, and stops covering the cut when either changes.
const REVIEW = "plan/review.json";
export function reviewSubject(project) {
  const video = `out/${project.config.name}.mp4`, file = join(project.root, video);
  if (!existsSync(file)) return null;
  const st = statSync(file);
  // Whole seconds: renders synced back from a worker may lose sub-second mtime precision.
  return { video, bytes: st.size, mtime: Math.floor(st.mtimeMs / 1000), timeline: productsHash(project.root, ["plan/timeline.json"]) };
}

// Why the QC report no longer covers the main cut, or null when it does (or there is none).
export function reviewOutdated(project) {
  const review = readJson(join(project.root, REVIEW), null);
  if (!review) return null;
  const was = review.subject, now = reviewSubject(project);
  if (!was) return "the QC report does not record which render it checked; run: onevideo qc";
  if (!now) return `${was.video} is gone; render, then: onevideo qc`;
  if (now.video !== was.video || now.bytes !== was.bytes || now.mtime !== was.mtime) return `${now.video} was rendered again after QC; run: onevideo qc`;
  if (now.timeline !== was.timeline) return "plan/timeline.json changed after QC; render, then: onevideo qc";
  return null;
}

export function loadState(project) {
  return readJson(project.paths.state, { stages: {} });
}

export function stageStatus(project, pipeline, state = loadState(project)) {
  const out = [];
  let blocked = false;
  for (const stage of pipeline.stages) {
    const products = stageProducts(project, stage);
    const hash = products.length ? productsHash(project.root, products) : null;
    const rec = state.stages[stage.id];
    const outdated = hash !== null && products.includes(REVIEW) ? reviewOutdated(project) : null;
    let status;
    if (hash === null) status = stage.optional ? "optional" : "pending";
    else if (outdated) status = "stale";
    else if (!stage.approval) status = "done";
    else if (rec?.hash === hash) status = "approved";
    else if (rec?.hash) status = "stale";
    else status = "awaiting-approval";
    const row = { ...stage, produces: products, status, blocked, approvedAt: rec?.at ?? null, ...(outdated ? { reason: outdated } : {}) };
    out.push(row);
    if (!["done", "approved", "optional"].includes(status)) blocked = true;
  }
  return out;
}

export function approveStage(project, pipeline, stageId, note) {
  const stage = pipeline.stages.find((s) => s.id === stageId);
  if (!stage) throw new UserError(`pipeline "${pipeline.name}" has no stage "${stageId}" (${pipeline.stages.map((s) => s.id).join(", ")})`);
  const products = stageProducts(project, stage);
  const hash = productsHash(project.root, products);
  if (hash === null) throw new UserError(`stage "${stageId}" has no products yet (${products.join(", ")})`);
  const outdated = products.includes(REVIEW) ? reviewOutdated(project) : null;
  if (outdated) throw new UserError(`cannot approve "${stageId}": ${outdated}`);
  const state = loadState(project);
  state.stages[stageId] = { hash, at: new Date().toISOString(), ...(note ? { note } : {}) };
  writeJson(project.paths.state, state);
  return state.stages[stageId];
}
