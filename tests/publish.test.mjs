import { test } from "node:test";
import assert from "node:assert/strict";
import { chapterTime, chapterList, creditsText, buildPublishKit, posterTime } from "../cli/lib/publish/kit.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, linkSync, copyFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mainVersion, publishedVersion } from "../cli/lib/publish/renders.mjs";
import { readQcBounds, writeQcBounds } from "../cli/lib/core/qc-bounds.mjs";
import { srtTime, toSrt, toVtt } from "../cli/lib/captions/index.mjs";
import { compileTimeline } from "../cli/lib/timeline/index.mjs";
import { example } from "./helpers.mjs";

test("srtTime / chapterTime formatting", () => {
  assert.equal(srtTime(3723.0456), "01:02:03,046");
  assert.equal(chapterTime(71.9), "01:11");
  assert.equal(chapterTime(3725), "1:02:05");
});

test("toSrt and toVtt", () => {
  const caps = [{ start: 0.2, end: 1.5, text: "你好" }];
  assert.equal(toSrt(caps), "1\n00:00:00,200 --> 00:00:01,500\n你好\n");
  assert.ok(toVtt(caps).startsWith("WEBVTT\n\n00:00:00.200 --> 00:00:01.500"));
});

test("chapterList adds 0:00, drops chapters under 10s and warns", () => {
  const { chapters, warnings } = chapterList([{ title: "A", start: 5 }, { title: "B", start: 30 }, { title: "C", start: 33 }], 60);
  assert.deepEqual(chapters.map((c) => c.title), ["开场", "B"]);
  assert.ok(warnings.some((w) => /≥3/.test(w)));
  assert.ok(warnings.some((w) => /shorter than 10s/.test(w)));
});

test("creditsText lists sources without URLs and the music credit", () => {
  const text = creditsText({ assets: {}, music: { credit: "OneVideo 程序化合成" } }, { facts: [{ source: { publisher: "Reuters", title: "定价", date: "2026-06-11" } }] });
  assert.equal(text, "数据来源：\n- Reuters · 定价 · 2026-06-11\n背景音乐：OneVideo 程序化合成");
  assert.equal(creditsText({ assets: {}, music: { credit: null } }, null), "");
});

test("AI-generated assets stay out of the description; the kit notes the platform tag instead", () => {
  const tl = { assets: { pad: { credit: "Pad · NASA · PD" }, ai: { credit: null, generated: true } }, captions: { items: [] }, chapters: [], duration: 10 };
  assert.equal(creditsText(tl, null), "素材来源：\n- Pad · NASA · PD");
  const kit = buildPublishKit({ timeline: tl, research: null, config: {}, script: {} });
  assert.doesNotMatch(kit.files["description.txt"], /AI/);
  assert.ok(kit.publish.warnings.some((w) => /1 AI-generated asset\(s\) in the cut \(ai\)/.test(w)));
});

test("buildPublishKit on the SpaceX example", () => {
  const ex = example();
  const { timeline } = compileTimeline({ ...ex, assets: null });
  const kit = buildPublishKit({ timeline, research: ex.research, config: ex.config, script: ex.script });
  assert.deepEqual(Object.keys(kit.files).sort(), ["captions.srt", "captions.vtt", "chapters.txt", "description.txt"]);
  const d = kit.files["description.txt"];
  assert.match(d, /章节：\n00:00 /);
  assert.match(d, /Reuters · SpaceX IPO 定价报道 · 2026-06-11/);
  assert.match(d, /https:\/\/www\.nasdaq\.com\//);
  assert.equal(kit.files["captions.srt"].split("-->").length - 1, timeline.captions.items.length);
});

test("the poster frame: into the second chapter, else a fifth of the way, never past the end", () => {
  assert.equal(posterTime({ chapters: [{ start: 0 }, { start: 40.967 }], duration: 70 }), 44.967);
  assert.equal(posterTime({ chapters: [{ start: 0 }], duration: 50 }), 10);
  assert.equal(posterTime({ chapters: [{ start: 0 }, { start: 9 }], duration: 11 }), 10.5);
});

test("mainVersion names the version file the main cut is, linked or copied", () => {
  const root = mkdtempSync(join(tmpdir(), "ov-main-"));
  mkdirSync(join(root, "out/versions"), { recursive: true });
  for (const v of [1, 2]) writeFileSync(join(root, `out/versions/v${v}.mp4`), `video ${v}`.repeat(v));
  const renders = [1, 2].map((v) => ({ v, file: `out/versions/v${v}.mp4`, alias: "out/demo.mp4" }));
  writeFileSync(join(root, "out/renders.json"), JSON.stringify({ renders }));
  const project = { root, paths: { out: join(root, "out") }, config: { name: "demo" } };
  const main = join(root, "out/demo.mp4");
  assert.equal(mainVersion(project, main), null);
  linkSync(join(root, "out/versions/v1.mp4"), main);
  assert.equal(mainVersion(project, main), "out/versions/v1.mp4");
  copyFileSync(join(root, "out/versions/v2.mp4"), join(root, "copy.mp4"));
  writeFileSync(join(root, "out/renders.json"), JSON.stringify({ renders }));
  const m2 = join(root, "out/demo2.mp4");
  copyFileSync(join(root, "out/versions/v2.mp4"), m2);
  writeFileSync(join(root, "out/renders.json"), JSON.stringify({ renders: renders.map((r) => ({ ...r, alias: "out/demo2.mp4" })) }));
  assert.equal(mainVersion(project, m2), "out/versions/v2.mp4");
});

test("publishing a cut rendered before versioning adopts it as a version the main file points at", () => {
  const root = mkdtempSync(join(tmpdir(), "ov-legacy-"));
  mkdirSync(join(root, "out"), { recursive: true });
  const project = { root, paths: { out: join(root, "out") }, config: { name: "demo" } };
  const main = join(root, "out/demo.mp4");
  writeFileSync(main, "old cut");
  assert.equal(publishedVersion(project, main), "out/versions/v1.mp4");
  assert.equal(readFileSync(main, "utf8"), "old cut");
  assert.equal(statSync(main).ino, statSync(join(root, "out/versions/v1.mp4")).ino);
  assert.equal(publishedVersion(project, main), "out/versions/v1.mp4"); // nothing adopted twice
  const log = JSON.parse(readFileSync(join(root, "out/renders.json"), "utf8")).renders;
  assert.equal(log.length, 1);
  assert.equal(log[0].alias, "out/demo.mp4");
  assert.ok(log[0].legacy);
});

test("publishing an unlogged cut preserves the main cut's QC bounds on both paths", () => {
  const root = mkdtempSync(join(tmpdir(), "ov-legacy-bounds-"));
  const out = join(root, "out"), main = join(out, "demo.mp4");
  mkdirSync(out);
  const project = { root, paths: { out }, config: { name: "demo" } };
  const bounds = { step: 15, samples: [[[0.25, 0.8, 0.75, 0.9]]] };
  writeFileSync(main, "unlogged cut");
  writeQcBounds(main, bounds);
  const published = publishedVersion(project, main);
  assert.equal(published, "out/versions/v1.mp4");
  assert.deepEqual(readQcBounds(join(root, published)), bounds);
  assert.deepEqual(readQcBounds(main), bounds);
});
