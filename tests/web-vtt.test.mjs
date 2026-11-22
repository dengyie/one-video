import { test } from "node:test";
import assert from "node:assert/strict";
import { cueAt, parseVtt, seconds } from "../web/site/vtt.mjs";

test("vtt: times in both forms", () => {
  assert.equal(seconds("00:00:07.740"), 7.74);
  assert.equal(seconds("01:02.5"), 62.5);
  assert.equal(seconds("1:00:00,001"), 3600.001);
  assert.equal(seconds("nope"), null);
});

test("vtt: cues parsed leniently, non-cue blocks skipped", () => {
  const src = "﻿WEBVTT\r\nKind: captions\r\n\r\nNOTE a comment\r\nwith --> an arrow? no, it is a note\r\n\r\nSTYLE\r\n::cue { color: red }\r\n\r\n"
    + "intro\r\n00:00:00.150 --> 00:00:07.740 align:start position:10%\r\n海边有一座<b>灯塔</b>，\r\n每天夜里 &amp; 清晨\r\n\r\n"
    + "00:08.850 --> 00:12.530\r\n<v 老人>灯亮着&nbsp;迷路的船\r\n\r\n00:13.000 --> 00:14.000\r\n<00:13.500>\r\n\r\n00:20.000 --> broken\r\nx\r\n";
  assert.deepEqual(parseVtt(src), [
    { start: 0.15, end: 7.74, text: "海边有一座灯塔， 每天夜里 & 清晨" },
    { start: 8.85, end: 12.53, text: "灯亮着 迷路的船" },
  ]);
  assert.deepEqual(parseVtt(""), []);
  assert.deepEqual(parseVtt(null), []);
});

test("vtt: cueAt finds the line being heard, keeping it lit through a pause", () => {
  const cues = [{ start: 0.15, end: 7.74 }, { start: 8.85, end: 12.53 }, { start: 13.58, end: 16.69 }];
  assert.equal(cueAt(cues, 0), -1);
  assert.equal(cueAt(cues, 0.15), 0);
  assert.equal(cueAt(cues, 8.2), 0);
  assert.equal(cueAt(cues, 8.81), 1);
  assert.equal(cueAt(cues, 99), 2);
  assert.equal(cueAt([], 3), -1);
});
