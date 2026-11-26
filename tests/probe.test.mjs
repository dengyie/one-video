import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REMOTION_BIN, TEMPLATE_DIR, run } from "../cli/lib/core/ffmpeg.mjs";
import { overlayProbeFrames, probeIssues } from "../cli/lib/review/probe.mjs";
import { frameRgb } from "../cli/lib/vision/screen.mjs";
import { deviceViewportHeight, statCardColumns } from "../shared/safe-layout.mjs";
import { hitsCaption } from "../shared/probe-order.mjs";
import { compileTimeline } from "../cli/lib/timeline/index.mjs";

// A 9:16 timeline with one scene and a stamp at y 0.5; probes are what Overlay.tsx probeBoxes logs.
const tl = () => ({
  width: 1080, height: 1920, fps: 30,
  scenes: [{ id: "s", start: 10, duration: 6, overlays: [{ type: "stamp", text: "史上最大", t: 1, end: 5, y: 0.5 }] }],
});
const shot = (overlays, texts) => [{ frame: 0, file: "x.jpg", scenes: [{ scene: "s", t: 2, overlays, texts }] }];
const title = { text: "募资", box: [0.2, 0.45, 0.8, 0.48] };

test("closing fade dims the default backdrop and hides clipped text from the stills probe", { skip: !existsSync(REMOTION_BIN) && "needs template dependencies" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ov-closing-probe-"));
  try {
    const theme = JSON.parse(readFileSync(new URL("../styles/midnight-data.json", import.meta.url), "utf8"));
    theme.background = "plain";
    const timeline = {
      width: 640, height: 360, fps: 30, duration: 2, totalFrames: 60, theme,
      captions: { enabled: false, items: [] }, sfx: [], narration: [], watermark: null,
      scenes: [{
        id: "credits", type: "sources", from: 0, start: 0, duration: 2, durationInFrames: 60,
        props: { title: "W".repeat(100) }, camera: { move: "static" },
        transitionOut: { type: "fade", frames: 18, tail: 0, direction: "left" },
      }],
    };
    const props = join(dir, "props.json"), job = join(dir, "job.json"), out = join(dir, "probe.json");
    const frames = [41, 42, 46, 50, 59].map((frame) => ({ frame, file: join(dir, `${frame}.jpg`) }));
    writeFileSync(props, JSON.stringify(timeline));
    writeFileSync(job, JSON.stringify({ entry: "src/index.ts", props, out, probe: true, publicDir: join(TEMPLATE_DIR, "public"), frames }));
    await run(process.execPath, [join(TEMPLATE_DIR, "stills.mjs"), job]);
    const [visible, start, fading, middle, black] = JSON.parse(readFileSync(out, "utf8"));
    assert.match(probeIssues([visible], timeline)[0]?.msg ?? "", /runs off the right edge/);
    assert.ok(fading.scenes[0]?.texts.some(({ text, a }) => text.startsWith("WWW") && a > 0.8 && a < 1));
    const backdropBlue = async ({ file }) => (await frameRgb(file, { width: 64 })).rgb[2];
    const [beforeBlue, startBlue, middleBlue] = await Promise.all([visible, start, middle].map(backdropBlue));
    assert.equal(startBlue, beforeBlue, "the backdrop is unchanged on the first fade frame");
    assert.ok(middleBlue > 0 && middleBlue < beforeBlue, "the backdrop has partly dimmed mid-fade");
    const { rgb } = await frameRgb(black.file, { width: 64 });
    assert.ok(rgb.every((channel) => channel === 0), "last still is black");
    assert.equal(black.scenes[0]?.scene, "credits");
    assert.deepEqual(probeIssues([black], timeline), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("layout probe flags captions in a protected viewport without generating an overlay fix", () => {
  const frames = shot([], []);
  frames[0].scenes[0].captionClashes = ["Chapter two"];
  const [issue] = probeIssues([...frames, ...frames], tl());
  assert.match(issue.msg, /caption "Chapter two" covers a protected subject at 12.0s/);
  assert.equal(issue.at.field, "captions");
  assert.equal(issue.fix, undefined);
});

test("portrait footage aligns occlusion with the sharp inset, not the full-frame blur", { skip: !existsSync(REMOTION_BIN) && "needs template dependencies" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ov-footage-inset-"));
  try {
    const publicDir = join(dir, "public");
    mkdirSync(publicDir);
    const svg = (background, subject) => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${background}"/><rect x="100" y="68" width="120" height="44" fill="${subject}"/></svg>`;
    writeFileSync(join(publicDir, "subject.svg"), svg("#0033aa", "#e02020"));
    writeFileSync(join(publicDir, "mask.svg"), svg("black", "white"));
    writeFileSync(join(publicDir, "insert.svg"), svg("#20f020", "#20f020"));
    const props = join(dir, "props.json"), job = join(dir, "job.json");
    const matte = { mode: "near", threshold: 0.5, soft: 0.01 };
    const screen = { asset: "insert", corners: [[0.08, 0.1], [0.92, 0.1], [0.92, 0.9], [0.08, 0.9]], t: 0, blend: "normal" };
    const effects = [
      { title: { text: "T", t: 0, y: 0.1, size: 40, behind: true, matte } },
      { screen: { ...screen, occlude: { asset: "mask" } } },
      { screen: { ...screen, occlude: { matte } } },
      { windows: { asset: "insert", count: 1, t: 0, gap: 0, matte } },
    ];
    const theme = JSON.parse(readFileSync(new URL("../styles/midnight-data.json", import.meta.url), "utf8"));
    writeFileSync(props, JSON.stringify({
      width: 360, height: 640, aspect: "9:16", fps: 30, duration: 4, totalFrames: 120, theme,
      captions: { enabled: false, items: [] }, sfx: [], narration: [], watermark: null,
      assets: {
        subject: { src: "subject.svg", kind: "image", depth: "mask.svg" },
        mask: { src: "mask.svg", kind: "image" },
        insert: { src: "insert.svg", kind: "image" },
      },
      scenes: effects.map((effect, i) => ({
        id: `shot-${i}`, type: "footage", from: i * 30, start: i, duration: 1, durationInFrames: 30,
        camera: { move: "static" }, props: { asset: "subject", portraitBackdropBlur: 30, dim: 0, ...effect },
      })),
    }));
    const frames = effects.map((_, i) => ({ frame: 24 + i * 30, file: join(dir, `${i}.jpg`) }));
    writeFileSync(job, JSON.stringify({ entry: "src/index.ts", props, publicDir, scale: 0.5, frames }));
    await run(process.execPath, [join(TEMPLATE_DIR, "stills.mjs"), job]);
    for (const [i, { file }] of frames.entries()) {
      const { rgb, w } = await frameRgb(file, { width: 180 });
      const pixel = (x, y) => rgb.subarray((y * w + x) * 3, (y * w + x) * 3 + 3);
      const [r, g, b] = pixel(90, 160);
      assert.ok(r > Math.max(g, b) + 50, `effect ${i}: the sharp red subject stays in front`);
      const [leftR, leftG, leftB] = pixel(33, 160);
      assert.ok(i === 0 ? leftB > leftR + 50 : leftG > Math.max(leftR, leftB) + 50,
        `effect ${i}: the subject must not extend beyond its fitted width`);
      const [topR, topG, topB] = pixel(90, 83);
      assert.ok(topB > Math.max(topR, topG), `effect ${i}: the upper backdrop must remain untouched`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("kinetic number and unit fit the portrait shot through the count-up and hold", { skip: !existsSync(REMOTION_BIN) && "needs template dependencies" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ov-kinetic-number-"));
  try {
    const theme = JSON.parse(readFileSync(new URL("../styles/vector-flow.json", import.meta.url), "utf8"));
    const timeline = {
      width: 540, height: 960, fps: 30, duration: 3, totalFrames: 90, theme,
      captions: { enabled: false, items: [] }, sfx: [], narration: [], watermark: null,
      scenes: [{
        id: "value", type: "kinetic", from: 0, start: 0, duration: 3, durationInFrames: 90,
        props: { lines: [{ text: "光速" }], number: { value: 299792458, format: { suffix: " 米/秒" }, cue: "number" } },
        cues: { number: 0.5 }, shots: [{ t: 0, zoom: 1.12, x: 0.52, y: 0.5 }],
      }],
    };
    const props = join(dir, "props.json"), job = join(dir, "job.json"), out = join(dir, "probe.json");
    const frames = [35, 46, 65].map((frame) => ({ frame, file: join(dir, `${frame}.jpg`) }));
    writeFileSync(props, JSON.stringify(timeline));
    writeFileSync(job, JSON.stringify({ entry: "src/index.ts", props, out, probe: true, publicDir: join(TEMPLATE_DIR, "public"), frames }));
    await run(process.execPath, [join(TEMPLATE_DIR, "stills.mjs"), job]);
    for (const { scenes } of JSON.parse(readFileSync(out, "utf8"))) {
      const value = scenes[0].texts.find((t) => t.text.endsWith("米/秒"));
      assert.ok(value && !value.cut && value.box[0] > 0.015 && value.box[2] < 0.985);
      assert.ok(value.box[3] - value.box[1] < 0.12, "the value and unit are on one line");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("probe counts a sticker's hits only when it is drawn in front of the caption", () => {
  const ink = {}, sticker = {}, background = {};
  const caption = { contains: (e) => e === ink || e === caption };
  const overlay = { contains: (e) => e === sticker || e === overlay };
  assert.equal(hitsCaption([ink, caption, sticker, overlay, background], overlay, caption), false);
  assert.equal(hitsCaption([sticker, overlay, ink, caption, background], overlay, caption), true);
});

test("the SpaceX Motion first-day flight keeps the proceeds below the header and the offering price offscreen", { skip: !existsSync(REMOTION_BIN) && "needs template dependencies" }, async () => {
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const example = (path) => read(`../examples/spacex-motion/${path}`);
  const script = example("plan/script.json");
  const storyboard = example("plan/storyboard.json");
  const assets = example("plan/assets.json");
  for (const asset of assets.items) asset.file = `assets/${asset.id}`;
  const timings = read("./fixtures/spacex-motion-timings.json");
  const dir = mkdtempSync(join(tmpdir(), "ov-spacex-header-"));
  try {
    for (const aspect of ["16:9", "9:16"]) {
      const config = { ...example("onevideo.json"), aspect };
      const { timeline, errors } = compileTimeline({ script, storyboard, assets, timings, config });
      assert.deepEqual(errors, []);
      const ipo = timeline.scenes.find((s) => s.id === "ipo");
      const takeoff = ipo.props.path.find((s) => s.cue === "pop").t;
      const morph = ipo.props.items.find((i) => i.id === "raise").morph[0].t;
      const frames = [...new Set([0, 0.2, 0.4, 0.6, 0.8, 1.3, morph - takeoff - 0.05].map(
        (offset) => Math.round((takeoff + offset) * timeline.fps),
      ))].map((frame) => ({ frame, file: join(dir, `${aspect.replace(":", "x")}-${frame}.jpg`) }));
      const props = join(dir, "props.json"), job = join(dir, "job.json"), out = join(dir, "probe.json");
      writeFileSync(props, JSON.stringify({
        ...timeline, totalFrames: ipo.durationInFrames, duration: ipo.duration,
        music: null, captions: { enabled: false, items: [] }, sfx: [], narration: [], watermark: null,
        scenes: [{ ...ipo, from: 0, start: 0, audio: null, transitionIn: null, transitionOut: null, backdrop: null }],
      }));
      writeFileSync(job, JSON.stringify({ entry: "src/index.ts", props, out, probe: true, publicDir: join(TEMPLATE_DIR, "public"), frames }));
      await run(process.execPath, [join(TEMPLATE_DIR, "stills.mjs"), job]);
      for (const { frame, scenes: [{ texts }] } of JSON.parse(readFileSync(out, "utf8"))) {
        const source = texts.find(({ text }) => text === ipo.header.subtitle);
        const label = texts.find(({ text }) => text === "募资（含超额配售）");
        const proceeds = texts.find(({ text }) => text === "857亿美元");
        assert.ok(source && label && proceeds && label.box[1] > source.box[3] + 0.01 && proceeds.box[1] > source.box[3] + 0.01,
          `${aspect} frame ${frame}: the proceeds stat and label must both be visible below the header`);
        assert.ok(!texts.some(({ text }) => text === "发行价" || text === "$135"),
          `${aspect} frame ${frame}: the earlier offering-price card must stay offscreen`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("devices reserve caption space and portrait cards cap wide column counts", () => {
  assert.equal(deviceViewportHeight(1080, 1, false), 860);
  assert.equal(deviceViewportHeight(1920, 1, true), 1530);
  assert.equal(deviceViewportHeight(960, 0.5, true), 765);
  assert.equal(statCardColumns(4, 4, true), 2);
  assert.equal(statCardColumns(4, 4, false), 4);
  assert.equal(statCardColumns(3, 4, true), 1);
});

test("probeIssues flags a sticker hiding a line and finds a clear height", () => {
  const out = probeIssues(shot([{ i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [{ t: 0, area: 0.004 }] }], [title]), tl());
  assert.equal(out.length, 1);
  assert.equal(out[0].gate, "probe");
  assert.match(out[0].msg, /scene "s" overlay 0 \(stamp "史上最大"\) covers "募资" at 12\.0s — move it to y 0\.\d+/);
  assert.deepEqual(out[0].at, { scene: "s", from: 11, to: 15, field: "overlays[0]" });
  const y = Number(out[0].msg.match(/y (0\.\d+)/)[1]);
  assert.ok(y <= 0.47 || y >= 0.54, `y ${y} still meets the line`);
});

test("overlay probes sample between preview stills and never leave the scene", () => {
  const scene = { from: 90, duration: 5, durationInFrames: 150, overlays: [
    { type: "word", t: 2, end: 2.4 }, { type: "stamp", t: 4, end: 5.5 },
    { type: "flash", t: 3, end: 4 }, { type: "word", t: 5.1, end: 6 },
  ] };
  assert.deepEqual(overlayProbeFrames(scene, 30, [129, 219]), [156, 225]);
});

test("probe fixes avoid covering a different line later in the same overlay", () => {
  const rec = { i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [{ t: 0, area: 0.004 }] };
  const [initial] = probeIssues(shot([rec], [title]), tl());
  const dy = initial.fix.set.y - 0.5;
  const laterText = { text: "the next label", box: [0.3, 0.44 + dy, 0.7, 0.52 + dy] };
  const later = shot([{ ...rec, covers: [] }], [laterText]);
  const [both] = probeIssues([...shot([rec], [title]), ...later], tl());
  const moved = both.fix.set.y - 0.5;
  assert.ok(0.52 + moved <= laterText.box[1] || 0.44 + moved >= laterText.box[3]);
});

test("probeIssues trusts hit-tested coverage over the bounding box", () => {
  // The tilted stamp's box overlaps the line, but its drawn shape hides only a sliver.
  assert.deepEqual(probeIssues(shot([{ i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [{ t: 0, area: 0.0001 }] }], [title]), tl()), []);
  assert.deepEqual(probeIssues(shot([{ i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [] }], [title]), tl()), []);
  // Without measured coverage the box overlap decides.
  assert.equal(probeIssues(shot([{ i: 0, box: [0.3, 0.44, 0.7, 0.52] }], [title]), tl()).length, 1);
});

test("probeIssues says each pair once and ignores unknown scenes and overlays", () => {
  const rec = { i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [{ t: 0, area: 0.004 }] };
  const probes = [...shot([rec], [title]), ...shot([rec], [title]), { frame: 1, scenes: [{ scene: "zz", t: 0, overlays: [rec], texts: [title] }] }];
  assert.equal(probeIssues(probes, tl()).length, 1);
  assert.deepEqual(probeIssues(shot([{ ...rec, i: 3 }], [title]), tl()), []);
});

test("probeIssues moves an anchored overlay by its offset, in layout units", () => {
  const t = tl();
  Object.assign(t.scenes[0].overlays[0], { on: "card1", offset: [0, 20] });
  const [w] = probeIssues(shot([{ i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [{ t: 0, area: 0.004 }] }], [title]), t);
  assert.equal(w.fix.set.offset[0], 0);
  // 1u = 1px at 1080 wide: a move of dy of the 1920 frame is dy * 1920 units.
  const dy = (w.fix.set.offset[1] - 20) / 1920;
  assert.ok(Math.abs(dy) >= 0.04 && Math.abs(dy) <= 0.09, String(dy));
  assert.match(w.msg, /move it to offset \[0, -?\d+\]/);
});

test("probe fixes: the main cut moves the overlay, a variant writes only its own aspects entry", async () => {
  const { applyFix } = await import("../cli/lib/review/fixes.mjs");
  const rec = { i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [{ t: 0, area: 0.004 }] };
  const [main] = probeIssues(shot([rec], [title]), tl());
  assert.deepEqual(main.fix.path, ["overlays", 0]);
  const [v] = probeIssues(shot([rec], [title]), tl(), { variant: "9:16" });
  assert.match(v.msg, / in 9:16 \(onevideo fix\)/);
  const y = v.fix.set["9:16"].y;
  const sb = { scenes: [{ id: "s", overlays: [{ type: "stamp", y: 0.5, aspects: { "9:16": { x: 0.3 } } }] }] };
  assert.ok(applyFix(sb, v.fix));
  assert.deepEqual(sb.scenes[0].overlays[0], { type: "stamp", y: 0.5, aspects: { "9:16": { x: 0.3, y } } });
  const bare = { scenes: [{ id: "s", overlays: [{ type: "stamp", y: 0.5 }] }] };
  assert.ok(applyFix(bare, v.fix));
  assert.deepEqual(bare.scenes[0].overlays[0].aspects, { "9:16": { y } });
});

test("probe spots move sideways when no height clears the text, and keep off other stickers", () => {
  // Lines down the whole left half (a long list): only the right half is clear.
  const column = Array.from({ length: 18 }, (_, k) => ({ text: `行${k}`, box: [0.05, 0.05 + k * 0.05, 0.55, 0.08 + k * 0.05] }));
  const rec = { i: 0, box: [0.3, 0.4, 0.5, 0.5], covers: [{ t: 7, area: 0.004 }] };
  const [side] = probeIssues(shot([rec], column), tl());
  assert.deepEqual(side.fix.set, { x: 0.75 });
  assert.match(side.msg, /move it to x 0\.75 \(onevideo fix\)/);
  // A second sticker sits just above the stamp: the clear height below is taken instead.
  const t = tl();
  t.scenes[0].overlays.push({ type: "icon", t: 1, end: 5 });
  const [below] = probeIssues(shot([{ i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [{ t: 0, area: 0.004 }] }, { i: 1, box: [0.3, 0.3, 0.7, 0.44], covers: [] }], [title]), t);
  assert.ok(below.fix.set.y > 0.5, JSON.stringify(below.fix.set));
});

test("probeIssues reports scene text cut at the frame edge once, naming the shot when it is pushed in", () => {
  const cutTitle = { text: "SpaceX", box: [0, 0.3, 1, 0.4], cut: ["left", "right"] };
  const probes = [...shot([], [cutTitle, title]), ...shot([], [cutTitle])];
  const out = probeIssues(probes, tl());
  assert.equal(out.length, 1);
  assert.match(out[0].msg, /scene "s" text "SpaceX" runs off the left and right edge at 12\.0s — make the text smaller or shorter, or break the line/);
  const t = tl();
  t.scenes[0].shots = [{ t: 0, zoom: 1 }, { t: 1.5, zoom: 1.2 }, { t: 5, zoom: 1 }];
  assert.match(probeIssues(probes, t)[0].msg, /keep the shot wider there/);
});

test("probeIssues lets text the camera carries past the edge go while it travels, not once it holds", () => {
  const cutTitle = { text: "857亿美元", box: [0.2, -0.05, 0.8, 0.04], cut: ["top"] };
  const flying = [{ frame: 0, file: "x.jpg", scenes: [{ scene: "s", t: 2, moving: true, overlays: [], texts: [cutTitle] }] }];
  assert.deepEqual(probeIssues(flying, tl()), []);
  // A sticker over a line is still a clash mid-flight.
  const over = [{ frame: 0, file: "x.jpg", scenes: [{ scene: "s", t: 2, moving: true, overlays: [{ i: 0, box: [0.3, 0.44, 0.7, 0.52], covers: [{ t: 0, area: 0.004 }] }], texts: [title] }] }];
  assert.equal(probeIssues(over, tl()).length, 1);
  assert.equal(probeIssues([...flying, ...shot([], [cutTitle])], tl()).length, 1);
});

// Scene text over scene text: map labels stacked on one another, crowded chart labels.
const labels = (a, b) => shot([], [{ text: "东京·羽田国际机场", box: [0.7, 0.38, 0.86, 0.41], ...a }, { text: "上海—东京航线", box: [0.72, 0.39, 0.85, 0.42], ...b }]);

test("probeIssues flags scene text sitting on other scene text, once per pair", () => {
  const out = probeIssues([...labels(), ...labels()], tl());
  assert.equal(out.length, 1);
  assert.equal(out[0].gate, "probe");
  assert.match(out[0].msg, /scene "s" text "东京·羽田国际机场" and "上海—东京航线" overlap at 12\.0s/);
  assert.deepEqual(out[0].at, { scene: "s", from: 12, to: 12, field: "props" });
});

test("probeIssues leaves text overlaps that do not read as a clash", () => {
  // The same words drawn twice (an echo, an outline layer).
  assert.deepEqual(probeIssues(labels({}, { text: "东京·羽田国际机场" }), tl()), []);
  // A line its ancestors clip away (an odometer reel's hidden digits), or show only clear of the other.
  assert.deepEqual(probeIssues(labels({}, { v: [] }), tl()), []);
  assert.deepEqual(probeIssues(labels({}, { v: [0.72, 0.41, 0.85, 0.42] }), tl()), []);
  // Mid-crossfade: one of them is fading.
  assert.deepEqual(probeIssues(labels({ a: 0.6 }), tl()), []);
  // Lines touching at their edges: the overlap stays outside the inked middle.
  assert.deepEqual(probeIssues(labels({}, { box: [0.72, 0.405, 0.85, 0.435] }), tl()), []);
});

test("probeIssues trusts hit-tested text coverage: a label plate over a line, not boxes that touch", () => {
  // The route label's plate hides the lower half of the pin label though the text boxes only graze.
  const texts = [{ text: "东京·羽田国际机场", box: [0.718, 0.376, 0.866, 0.42], over: [{ t: 1, area: 0.002 }] }, { text: "上海—东京航线", box: [0.738, 0.402, 0.861, 0.446] }];
  const [w, ...rest] = probeIssues([{ frame: 0, scenes: [{ scene: "s", t: 2, overlays: [], texts, hit: true }] }], tl());
  assert.deepEqual(rest, []);
  assert.match(w.msg, /text "上海—东京航线" covers "东京·羽田国际机场" at 12\.0s/);
  // Measured, and nothing on top: boxes that do meet are left alone.
  assert.deepEqual(probeIssues([{ frame: 0, scenes: [{ scene: "s", t: 2, overlays: [], texts: labels()[0].scenes[0].texts, hit: true }] }], tl()), []);
  // A sliver under the plate is not a clash.
  texts[0].over[0].area = 0.0001;
  assert.deepEqual(probeIssues([{ frame: 0, scenes: [{ scene: "s", t: 2, overlays: [], texts, hit: true }] }], tl()), []);
});
