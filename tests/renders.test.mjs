import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptLegacy, frameRange, readRenders, recordRender, resolveVideo, versionFile } from "../cli/lib/publish/renders.mjs";

const TL = { fps: 30, duration: 10, scenes: [{ id: "a", from: 0, durationInFrames: 90 }, { id: "b", from: 90, durationInFrames: 120 }, { id: "c", from: 210, durationInFrames: 90 }] };

test("frameRange: scenes, seconds, or nothing", () => {
  assert.deepEqual(frameRange(TL, { scenes: "b" }), [90, 209]);
  assert.deepEqual(frameRange(TL, { scenes: "c,a" }), [0, 299]);
  assert.deepEqual(frameRange(TL, { from: 2, to: 4 }), [60, 119]);
  assert.deepEqual(frameRange(TL, { from: 8 }), [240, 299]);
  assert.equal(frameRange(TL, {}), null);
  assert.throws(() => frameRange(TL, { scenes: "a,zz" }), /unknown scene\(s\): zz/);
  assert.throws(() => frameRange(TL, { from: 5, to: 5 }), /empty range/);
  assert.deepEqual(frameRange(TL, { frames: "60-119" }), [60, 119]);
  assert.deepEqual(frameRange(TL, { frames: "0-9999" }), [0, 299]);
  assert.throws(() => frameRange(TL, { frames: "90" }), /--frames takes/);
  assert.throws(() => frameRange(TL, { frames: "200-100" }), /empty range/);
  // A bare --from parses as true, not as 0.
  assert.throws(() => frameRange(TL, { from: true }), /--from takes seconds/);
  assert.throws(() => frameRange(TL, { to: "soon" }), /--to takes seconds/);
});

function project() {
  const root = mkdtempSync(join(tmpdir(), "ov-renders-"));
  mkdirSync(join(root, "out", "versions"), { recursive: true });
  return { root, config: { name: "demo", render: { keepVersions: 2 } }, paths: { out: join(root, "out") } };
}

function render(p, opts = {}, content) {
  const { v, file } = versionFile(p, opts);
  writeFileSync(file, content ?? `render ${v}`);
  const alias = join(p.paths.out, `demo${opts.part ? ".part" : opts.draft ? ".draft" : ""}.mp4`);
  return recordRender(p, { v, file, draft: Boolean(opts.draft), part: Boolean(opts.part), offset: opts.offset ?? 0, frames: [0, 9], timeline: "h" }, { alias });
}

test("recordRender: numbered versions, alias to the newest, old ones pruned but logged", () => {
  const p = project();
  const r1 = render(p, { draft: true });
  assert.equal(r1.file, "out/versions/v1-draft.mp4");
  assert.equal(r1.alias, "out/demo.draft.mp4");
  render(p, { draft: true });
  // The alias is re-pointed, never written through: v1 keeps its own bytes.
  assert.equal(readFileSync(join(p.paths.out, "demo.draft.mp4"), "utf8"), "render 2");
  assert.equal(readFileSync(join(p.paths.out, "versions", "v1-draft.mp4"), "utf8"), "render 1");
  render(p, { part: true, offset: 3 });
  const log = readRenders(p);
  assert.deepEqual(log.map((r) => [r.v, Boolean(r.pruned)]), [[1, true], [2, false], [3, false]]);
  assert.ok(!existsSync(join(p.paths.out, "versions", "v1-draft.mp4")));
  assert.equal(log[2].file, "out/versions/v3-part.mp4");
  assert.equal(log[2].bytes, statSync(join(p.root, log[2].file)).size);
});

test("resolveVideo: newest, prev, vN, N, a path or an alias", () => {
  const p = project();
  const fallback = join(p.paths.out, "demo.mp4");
  assert.deepEqual(resolveVideo(p, undefined, fallback), { file: fallback, offset: 0, entry: null });
  render(p, {});
  render(p, { part: true, offset: 4.5 });
  assert.equal(resolveVideo(p).entry.v, 2);
  assert.equal(resolveVideo(p).offset, 4.5);
  assert.equal(resolveVideo(p, "prev").entry.v, 1);
  assert.equal(resolveVideo(p, "v1").file, join(p.root, "out/versions/v1.mp4"));
  assert.equal(resolveVideo(p, "2").offset, 4.5);
  assert.equal(resolveVideo(p, join(p.paths.out, "demo.part.mp4")).entry.v, 2);
  assert.equal(resolveVideo(p, "/elsewhere/x.mp4").entry, null);
  assert.throws(() => resolveVideo(p, "v9"), /no render v9/);
  render(p, {});
  assert.throws(() => resolveVideo(p, "v1"), /was pruned/);
  // Archived before it was pruned: point at restore.
  mkdirSync(join(p.root, "plan"), { recursive: true });
  writeFileSync(join(p.root, "plan", "archive.json"), JSON.stringify({ files: { "out/versions/v1.mp4": { pruned: true } } }));
  assert.throws(() => resolveVideo(p, "v1"), /on the drive only: onevideo restore out\/versions\/v1\.mp4/);
});

test("adoptLegacy: an unversioned render becomes v1 instead of being overwritten", () => {
  const p = project();
  const alias = join(p.paths.out, "demo.mp4");
  writeFileSync(alias, "old cut");
  const old = adoptLegacy(p, alias);
  assert.equal(old.v, 1);
  assert.equal(old.legacy, true);
  assert.equal(readFileSync(join(p.root, old.file), "utf8"), "old cut");
  assert.ok(!existsSync(alias));
  const r2 = render(p);
  assert.equal(r2.v, 2);
  // Now the alias is a logged version's link: nothing to adopt.
  assert.equal(adoptLegacy(p, alias), null);
  assert.equal(adoptLegacy(p, join(p.paths.out, "missing.mp4")), null);
  assert.deepEqual(readRenders(p).map((r) => r.v), [1, 2]);
});

test("adoptLegacy: an alias the log already knows is not adopted again", () => {
  const p = project();
  const alias = join(p.paths.out, "demo.mp4");
  render(p);
  render(p);
  render(p); // v1 pruned
  // A copy (not a link) of a logged render, e.g. after rsync or a filesystem without hard links.
  writeFileSync(alias, "render 3");
  assert.equal(adoptLegacy(p, alias), null);
  assert.deepEqual(readRenders(p).map((r) => r.v), [1, 2, 3]);
});
