import { test } from "node:test";
import assert from "node:assert/strict";
import { chapterTime, chapterList, creditsText, buildPublishKit } from "../cli/lib/publish/kit.mjs";
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
