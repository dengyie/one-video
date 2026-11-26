import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, estimatedTimings, example } from "./helpers.mjs";
import { compileTimeline } from "../cli/lib/timeline/index.mjs";
import { CUE_LEAD, phraseTime } from "../cli/lib/timeline/cues.mjs";
import { racePeriods } from "../cli/lib/timeline/events.mjs";
import { barRaceSwapDuration } from "../shared/bar-race.mjs";
import { boxOnScreen, cameraAt, elementAt, elementGeometry, ridgeTop, stageOf, stateAt } from "../shared/tableau.mjs";
import { resolveApiKey, viaApiBase, requireApiKey } from "../cli/lib/core/http.mjs";
import { reviewSubject } from "../cli/lib/core/state.mjs";
import { fixPlan } from "../cli/lib/review/fixes.mjs";

const CLI = join(ROOT, "cli", "onevideo.mjs");
const ov = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, HOME: cwd, ONEVIDEO_WORKERS: "" } });
const json = (p) => JSON.parse(readFileSync(p, "utf8"));

function exampleProject() {
  const dir = join(mkdtempSync(join(tmpdir(), "ov-cli-")), "demo");
  const r = ov(ROOT, "init", dir, "--example", "spacex-ipo");
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

test("Promo Demo keeps its URL readable after the short CTA narration", async () => {
  const dir = join(ROOT, "examples", "promo-demo");
  const config = json(join(dir, "onevideo.json"));
  const script = { scenes: [json(join(dir, "plan", "script.json")).scenes.at(-1)] };
  const storyboard = { scenes: [json(join(dir, "plan", "storyboard.json")).scenes.at(-1)] };
  const timings = await estimatedTimings(script, config);
  const { timeline, errors } = compileTimeline({ config, script, storyboard, timings });
  assert.deepEqual(errors, []);
  const [cta] = timeline.scenes;
  assert.equal(cta.type, "title");
  assert.equal(cta.lines[0].text, "打开链接就能看");
  const fadeStart = cta.duration - cta.transitionOut.frames / timeline.fps;
  assert.ok(fadeStart - cta.lines[0].end >= 1, "leave the URL readable after the spoken CTA");
});

test("Promo Demo captures the detail page for the same card the storyboard taps", () => {
  const plan = join(ROOT, "examples", "promo-demo", "plan");
  const { props } = json(join(plan, "storyboard.json")).scenes.find((scene) => scene.id === "open");
  const { items } = json(join(plan, "assets.json"));
  const capture = (id) => items.find((item) => item.id === props.screens.find((screen) => screen.id === id).asset).capture;
  const tap = props.steps.find((step) => step.tap);
  const detail = props.steps.find((step) => step.screen);
  const home = capture(props.screens[0].id);
  const result = capture(detail.screen);
  const tappedSelector = home.selectors[tap.tap];
  assert.ok(tappedSelector);
  assert.match(tappedSelector, /:not\(\[aria-current\]\)/);
  assert.equal(result.url, home.url);
  assert.deepEqual(result.click, [tappedSelector]);
});

test("Promo Demo opens the detail before the narrator describes the summary and downloads", async () => {
  const dir = join(ROOT, "examples", "promo-demo");
  const config = json(join(dir, "onevideo.json"));
  const [storyboard, script, assets] = ["storyboard", "script", "assets"].map((name) => json(join(dir, "plan", `${name}.json`)));
  for (const item of assets.items) {
    item.file = `assets/${item.id}.png`;
    item.rects = Object.fromEntries(Object.keys(item.capture.selectors).map((name) => [name, [0.1, 0.4, 0.8, 0.1]]));
  }
  const timings = await estimatedTimings(script, config);
  for (const aspect of ["16:9", "9:16"]) {
    const { timeline, errors } = compileTimeline({ config: { ...config, aspect }, script, storyboard, assets, timings });
    assert.deepEqual(errors, []);
    const { props, lines } = timeline.scenes.find((scene) => scene.id === "open");
    const [tap, detail] = props.steps;
    assert.ok(tap.tap && detail.screen === "detail" && detail.focus);
    assert.ok(tap.t < detail.t && detail.t - tap.t <= 0.3, aspect + ": the card tap directly opens the detail");
    const summary = phraseTime(lines, "简介"), download = phraseTime(lines, "下载");
    assert.ok(summary !== null && detail.t + 0.4 <= summary, aspect + ": finish switching pages before the summary is spoken");
    assert.ok(download !== null && detail.t + 0.8 <= download, aspect + ": settle the close-up before the download is spoken");
  }
});

test("Promo Demo shows the player after tapping the same chapter it captures", async () => {
  const dir = join(ROOT, "examples", "promo-demo");
  const config = json(join(dir, "onevideo.json"));
  const [storyboard, script, assets] = ["storyboard", "script", "assets"].map((name) => json(join(dir, "plan", `${name}.json`)));
  const { screens, steps } = storyboard.scenes.find(({ id }) => id === "chapters").props;
  const [tap, jump] = steps;
  const capture = (screen) => assets.items.find(({ id }) => id === screen.asset).capture;
  const before = capture(screens[0]), after = capture(screens.find(({ id }) => id === jump.screen));
  const chapter = before.selectors[tap.tap];
  assert.match(chapter, /^\.chapters button\[data-i="[1-9]\d*"\]$/);
  assert.equal(after.url, before.url);
  assert.deepEqual(after.click, [...before.click, chapter]);
  assert.equal(after.selectors.activeChapter, chapter + '[aria-current="true"]');
  assert.equal(after.selectors.player, before.selectors.player);
  assert.equal(tap.expand, undefined);
  for (const item of assets.items) {
    item.file = `assets/${item.id}.png`;
    item.rects = Object.fromEntries(Object.keys(item.capture.selectors).map((name) => [name, [0.1, 0.4, 0.8, 0.1]]));
  }
  const timings = await estimatedTimings(script, config);
  for (const aspect of ["16:9", "9:16"]) {
    const { timeline, errors } = compileTimeline({ config: { ...config, aspect }, script, storyboard, assets, timings });
    assert.deepEqual(errors, []);
    const scene = timeline.scenes.find(({ id }) => id === "chapters");
    const [tapped, switched] = scene.props.steps;
    assert.ok(tapped.t < switched.t && switched.t - tapped.t <= 0.3, `${aspect}: switch the player promptly after tapping`);
    assert.ok(switched.t < phraseTime(scene.lines, "跳过去"), `${aspect}: show the seek as it is narrated`);
    assert.ok(scene.duration - switched.t >= 1, `${aspect}: hold the new player time long enough to read`);
  }
});

test("Keeper has the new lighthouse lamp framed when the narration reveals it", async () => {
  const dir = join(ROOT, "examples", "keeper");
  const base = json(join(dir, "onevideo.json"));
  const script = json(join(dir, "plan", "script.json"));
  const storyboard = json(join(dir, "plan", "storyboard.json"));
  for (const aspect of ["16:9", "9:16"]) {
    const config = { ...base, aspect };
    const { timeline, errors } = compileTimeline({ config, script, storyboard, timings: await estimatedTimings(script, config) });
    assert.deepEqual(errors, []);
    const frame = { W: timeline.width, H: timeline.height };
    const { lines, cues, props } = timeline.scenes.find((scene) => scene.id === "home");
    const reveal = phraseTime(lines, "多了一盏灯");
    assert.ok(reveal !== null);
    const lamp = props.elements.find((el) => el.id === "lamp2");
    assert.equal(lamp.t, cues.more);
    for (const t of [reveal, reveal + 0.45]) {
      const { depth, box } = elementGeometry(stateAt(lamp, props.elements, t), frame);
      const [left, top, right, bottom] = boxOnScreen(cameraAt(props.camera, t), depth, box, stageOf(frame.W, frame.H).kx);
      assert.ok(left >= 0.15 && right <= 0.85 && top >= 0.1 && bottom <= 0.5, `${aspect} at ${t}: keep the lamp near the center, got ${[left, top, right, bottom]}`);
    }
  }
});

test("Keeper lights the coat beside the keeper, not on the far side of the lighthouse", async () => {
  const dir = join(ROOT, "examples", "keeper");
  const base = json(join(dir, "onevideo.json"));
  const script = json(join(dir, "plan", "script.json"));
  const storyboard = json(join(dir, "plan", "storyboard.json"));
  for (const aspect of ["16:9", "9:16"]) {
    const config = { ...base, aspect };
    const { timeline, errors } = compileTimeline({ config, script, storyboard, timings: await estimatedTimings(script, config) });
    assert.deepEqual(errors, []);
    const { props, cues } = timeline.scenes.find((scene) => scene.id === "fire");
    const t = cues.burn + 1.6;
    const state = (id) => stateAt(props.elements.find((el) => el.id === id), props.elements, t);
    const keeper = state("keeper"), blaze = state("blaze"), tower = state("lh");
    assert.equal(blaze.intensity, 1);
    assert.equal(blaze.y, keeper.y);
    assert.equal(blaze.depth, keeper.depth);
    assert.ok(blaze.x > tower.x && Math.abs(blaze.x - keeper.x) < 0.01, `${aspect}: stage the fire next to the keeper`);
  }
});

test("SpaceX IPO lands chart details on their narration in both aspects", async () => {
  const { config: base, script, storyboard, fetchedAssets: assets } = example();
  for (const aspect of ["16:9", "9:16"]) {
    const config = { ...base, aspect };
    const { timeline, errors } = compileTimeline({ config, script, storyboard, assets, timings: await estimatedTimings(script, config) });
    assert.deepEqual(errors, []);
    const scene = (id) => timeline.scenes.find((s) => s.id === id);
    const landsOn = (sc, cue, phrase) => {
      const said = phraseTime(sc.lines, phrase);
      const time = sc.cues[cue];
      assert.ok(said !== null && Math.abs(time - (said - CUE_LEAD)) < 0.05, `${aspect} ${sc.id}: cue ${phrase} with the narration`);
      return time;
    };
    const ipo = scene("ipo");
    const proceeds = ipo.props.cards.find((c) => c.value === 85.7e9);
    const record = landsOn(ipo, proceeds.noteCue, "史上");
    assert.ok(record > ipo.cues[proceeds.cue] + 1, "do not reveal the record with the proceeds");
    const race = scene("race");
    const ntt = landsOn(race, race.props.series.find((s) => s.name === "NTT").cue, "1187亿");
    const spacex = landsOn(race, race.props.series.find((s) => s.name === "SpaceX").cue, "SpaceX");
    const [, nextPeriod, , lastPeriod] = racePeriods(race);
    assert.ok(ntt < nextPeriod && spacex > lastPeriod, "highlight each bar while its narrated period is on screen");
    landsOn(race, race.props.periodCues.at(-1), "苹果");
    const appleFirst = phraseTime(race.lines, "排在第一");
    const appleAmount = phraseTime(race.lines, "5.1万亿");
    const lastSwap = barRaceSwapDuration(race.duration - lastPeriod, race.props.maxSwapDuration);
    assert.ok(appleFirst !== null && lastPeriod + lastSwap <= appleFirst, `${aspect}: settle on the 2026 ranking before the narrator names Apple as first`);
    assert.ok(appleAmount !== null && lastPeriod + lastSwap <= appleAmount, `${aspect}: show Apple's final market cap, not an interpolated amount, when it is spoken`);
    const revenue = scene("revenue");
    const total = landsOn(revenue, revenue.props.total?.cue, "187亿");
    assert.equal(revenue.props.segments.reduce((sum, s) => sum + s.value, 0), 18.7e9);
    assert.ok(total < revenue.cues[revenue.props.segments[0].cue], "show the total before breaking it down");
    const profit = scene("profit");
    const ai = landsOn(profit, profit.props.right.itemCues?.[0], "AI业务是主要拖累");
    assert.ok(ai > profit.cues[profit.props.right.cue] + 1, "show the reason separately from the loss");
  }
});

test("Graphics Demo keeps its final light-travel comparison compact in portrait", async () => {
  const dir = join(ROOT, "examples", "graphics-demo");
  const config = { ...json(join(dir, "onevideo.json")), aspect: "9:16" };
  const script = json(join(dir, "plan", "script.json"));
  const storyboard = json(join(dir, "plan", "storyboard.json"));
  const { timeline, errors } = compileTimeline({ config, script, storyboard, timings: await estimatedTimings(script, config) });
  assert.deepEqual(errors, []);
  const { props } = timeline.scenes.find((scene) => scene.id === "travel");
  const { focus } = props.path.at(-1);
  assert.deepEqual(focus, ["moon", "sun", "bar-moon", "bar-sun"]);
  const widths = props.items.filter(({ id }) => focus.includes(id)).map(({ x, w = 520 }) => [x - w / 2, x + w / 2]);
  const span = Math.max(...widths.map(([, right]) => right)) - Math.min(...widths.map(([left]) => left));
  assert.ok(span <= 1350, "the portrait pullback should not shrink the comparison across a wide gap");
});

test("Graphics Demo keeps the seconds conversion above the cards during the pullback", async () => {
  const dir = join(ROOT, "examples", "graphics-demo");
  const script = json(join(dir, "plan", "script.json"));
  const storyboard = json(join(dir, "plan", "storyboard.json"));
  for (const aspect of ["16:9", "9:16"]) {
    const config = { ...json(join(dir, "onevideo.json")), aspect };
    const { timeline, errors } = compileTimeline({ config, script, storyboard, timings: await estimatedTimings(script, config) });
    assert.deepEqual(errors, []);
    const { props, overlays } = timeline.scenes.find((scene) => scene.id === "travel");
    const conversion = overlays.find(({ text }) => text === "= 8 分 19 秒");
    assert.equal(conversion.t, props.path.at(-1).t);
    assert.ok(conversion.y >= 0.1 && conversion.y <= 0.15, aspect + ": keep the conversion in the upper band during the move");
  }
});

test("SpaceX Motion clears the opening title before the ticker lands", () => {
  const dir = join(ROOT, "examples", "spacex-motion");
  const read = (p) => json(join(dir, p));
  const script = read("plan/script.json"), storyboard = read("plan/storyboard.json"), assets = read("plan/assets.json");
  for (const asset of assets.items) asset.file = `assets/${asset.id}`;
  const timings = json(join(ROOT, "tests", "fixtures", "spacex-motion-timings.json"));
  for (const aspect of ["16:9", "9:16"]) {
    const { timeline, errors } = compileTimeline({ config: { ...read("onevideo.json"), aspect }, script, storyboard, assets, timings });
    assert.deepEqual(errors, []);
    const [hook] = timeline.scenes;
    const title = hook.props.title;
    const ticker = hook.overlays.find((overlay) => overlay.text === "SPCX");
    assert.ok(title.t + title.duration + 0.3 <= ticker.t, `${aspect}: the title including its exit must end before SPCX`);
  }
});

test("SpaceX Motion keeps a local scrim on featured words over the launch plume", () => {
  const dir = join(ROOT, "examples", "spacex-motion");
  const read = (p) => json(join(dir, p));
  const script = read("plan/script.json"), storyboard = read("plan/storyboard.json"), assets = read("plan/assets.json");
  for (const asset of assets.items) asset.file = `assets/${asset.id}`;
  const timings = json(join(ROOT, "tests", "fixtures", "spacex-motion-timings.json"));
  for (const aspect of ["16:9", "9:16"]) {
    const { timeline, errors } = compileTimeline({ config: { ...read("onevideo.json"), aspect }, script, storyboard, assets, timings });
    assert.deepEqual(errors, []);
    const [hook] = timeline.scenes;
    for (const text of ["SPCX", "凭什么？", "$1T+"]) {
      const overlay = hook.overlays.find((o) => o.type === "word" && o.text === text);
      assert.ok(overlay?.scrim > 0, `${aspect}: ${text} needs backing even without luma sidecars`);
    }
  }
});

test("SpaceX Motion shows connectivity revenue between the total and share callouts", () => {
  const dir = join(ROOT, "examples", "spacex-motion");
  const read = (p) => json(join(dir, p));
  const script = read("plan/script.json"), storyboard = read("plan/storyboard.json"), assets = read("plan/assets.json");
  for (const asset of assets.items) asset.file = `assets/${asset.id}`;
  const timings = json(join(ROOT, "tests", "fixtures", "spacex-motion-timings.json"));
  for (const aspect of ["16:9", "9:16"]) {
    const { timeline, errors } = compileTimeline({ config: { ...read("onevideo.json"), aspect }, script, storyboard, assets, timings });
    assert.deepEqual(errors, []);
    const { lines, overlays } = timeline.scenes.find((scene) => scene.id === "revenue");
    const [total, connectivity, share] = overlays;
    assert.equal(connectivity.text, "连接业务 $114亿");
    const said = phraseTime(lines, "114亿");
    assert.ok(said !== null && Math.abs(connectivity.t - (said - CUE_LEAD)) < 0.002, aspect + ": reveal the number on its spoken cue");
    assert.ok(total.end <= connectivity.t && connectivity.end <= share.t, aspect + ": keep the three callouts separate");
    assert.ok(connectivity.end - connectivity.t >= 1, aspect + ": keep the breakdown readable");
  }
});

test("SpaceX IPO reveals total revenue and the loss explanation on their narration cues", () => {
  const ex = example();
  const [ipo, revenuePlan, profitPlan] = ["ipo", "revenue", "profit"].map((id) => ex.storyboard.scenes.find((s) => s.id === id));
  delete ipo.cues[ipo.props.cards[1].noteCue];
  delete ipo.props.cards[1].noteCue;
  delete revenuePlan.cues[revenuePlan.props.total.cue];
  delete revenuePlan.props.total;
  delete profitPlan.cues[profitPlan.props.right.itemCues[0]];
  delete profitPlan.props.right.itemCues;
  const { check: { timeline, errors }, applied } = fixPlan({ config: ex.config, root: ex.root }, { ...ex, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  for (const scene of ["ipo", "revenue", "profit"]) assert.ok(applied.some((fix) => fix.scene === scene && fix.path[0] === "cues"));
  const revenue = timeline.scenes.find((s) => s.id === "revenue");
  const totalCue = revenue.cues[revenue.props.total?.cue];
  const totalLine = revenue.lines.find((line) => line.text.includes("187亿"));
  assert.ok(totalCue >= totalLine.start && totalCue < totalLine.end);
  assert.ok(totalCue < revenue.cues[revenue.props.segments[0].cue]);
  const profit = timeline.scenes.find((s) => s.id === "profit");
  const dragCue = profit.cues[profit.props.right.itemCues?.[0]];
  const dragLine = profit.lines.find((line) => line.text.includes("主要拖累"));
  assert.ok(dragCue > profit.cues[profit.props.right.cue]);
  assert.ok(dragCue >= dragLine.start - 0.21 && dragCue < dragLine.end);
  assert.ok(timeline.scenes.find((s) => s.id === "ipo").props.cards[1].noteCue);
});

test("approve script blocks an unsourced number even before a storyboard exists", () => {
  const dir = exampleProject();
  rmSync(join(dir, "plan", "storyboard.json"));
  const script = json(join(dir, "plan", "script.json"));
  script.scenes[0].narration += "市场规模将达到777万亿。";
  writeFileSync(join(dir, "plan", "script.json"), JSON.stringify(script));
  const r = ov(dir, "approve", "script");
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /"777万亿" not found in research facts/);
});

test("validate reports an unfetched media asset instead of crashing", () => {
  const dir = exampleProject();
  const sb = json(join(dir, "plan", "storyboard.json"));
  sb.scenes.splice(1, 0, { id: "photo", type: "media", duration: 3, props: { asset: "rocket" } });
  const script = json(join(dir, "plan", "script.json"));
  script.scenes.splice(1, 0, { id: "photo" });
  writeFileSync(join(dir, "plan", "storyboard.json"), JSON.stringify(sb));
  writeFileSync(join(dir, "plan", "script.json"), JSON.stringify(script));
  writeFileSync(join(dir, "plan", "assets.json"), JSON.stringify({ items: [{ id: "rocket", query: "falcon 9", license: "PD" }] }));
  writeFileSync(join(dir, "plan", "timings.json"), readFileSync(join(ROOT, "tests", "fixtures", "spacex-timings.json")));
  const r = ov(dir, "validate");
  assert.doesNotMatch(r.stderr, /TypeError/);
  assert.match(r.stdout, /\[timeline\] asset "rocket" not fetched/);
});

test("approvals survive copying the project to another directory", () => {
  const dir = exampleProject();
  assert.equal(ov(dir, "approve", "research").status, 0);
  const copy = join(mkdtempSync(join(tmpdir(), "ov-cli-")), "copy");
  cpSync(dir, copy, { recursive: true });
  assert.match(ov(copy, "status").stdout, /research\s+approved/);
});

test("publish requires the review stage to be approved", () => {
  const dir = exampleProject();
  const read = (f) => json(join(dir, "plan", f));
  const { timeline } = compileTimeline({ config: json(join(dir, "onevideo.json")), script: read("script.json"), storyboard: read("storyboard.json"), timings: json(join(ROOT, "tests", "fixtures", "spacex-timings.json")), research: read("research.json") });
  writeFileSync(join(dir, "plan", "timeline.json"), JSON.stringify(timeline));
  const project = { root: dir, config: json(join(dir, "onevideo.json")) };
  const video = join(dir, "out", `${project.config.name}.mp4`);
  writeFileSync(video, "cut 1");
  writeFileSync(join(dir, "plan", "review.json"), JSON.stringify({ verdict: "pass", checks: [], frames: [], subject: reviewSubject(project) }));
  const denied = ov(dir, "publish");
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /review stage is awaiting-approval/);
  assert.equal(ov(dir, "approve", "review").status, 0);
  const ok = ov(dir, "publish");
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(readFileSync(join(dir, "out", "publish", "captions.srt"), "utf8").length > 0);
  // The player site finds the cut on the drive as its version file (a pre-versioning cut is adopted).
  const pub = json(join(dir, "plan", "publish.json"));
  assert.equal(pub.video, "out/versions/v1.mp4");
  assert.match(pub.rendered, /^\d{4}-\d\d-\d\dT/);
  // A new render after sign-off is not the cut that was reviewed.
  writeFileSync(video, "cut 2, longer");
  const again = ov(dir, "publish");
  assert.equal(again.status, 1);
  assert.match(again.stderr, /review stage is stale \(out\/spacex-ipo\.mp4 was rendered again after QC/);
  assert.match(ov(dir, "approve", "review").stderr, /cannot approve "review"/);
});

test("a QC report that does not name its render cannot be approved", () => {
  const dir = exampleProject();
  writeFileSync(join(dir, "plan", "review.json"), JSON.stringify({ verdict: "pass", checks: [], frames: [] }));
  assert.match(ov(dir, "status").stdout, /review\s+stale/);
  const r = ov(dir, "approve", "review");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not record which render it checked/);
});

test("<command> --help prints its usage instead of running it", () => {
  const dir = exampleProject();
  for (const flag of ["--help", "-h"]) {
    const r = ov(dir, "publish", "--force", flag);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^onevideo publish \[--force\]/);
  }
  assert.ok(!existsSync(join(dir, "out", "publish")));
});

test("init rejects an aspect the timeline cannot lay out", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ov-cli-")), "bad");
  const r = ov(ROOT, "init", dir, "--aspect", "3:2");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--aspect "3:2": one of 16:9, 9:16, 1:1, 4:5/);
  assert.ok(!existsSync(dir));
});

test("shared API keys only go to trusted hosts", () => {
  const saved = { ...process.env };
  try {
    process.env.MANGO_API_KEY = "sk-test-shared";
    process.env.HOME = mkdtempSync(join(tmpdir(), "ov-home-"));
    delete process.env.ONEVIDEO_KEY_HOSTS;
    assert.equal(resolveApiKey("MANGO_API_KEY", "https://api.mangoqwq.com/v1").key, "sk-test-shared");
    assert.equal(resolveApiKey("MANGO_API_KEY", "https://evil.example/v1"), null);
    assert.throws(() => requireApiKey("MANGO_API_KEY", "https://evil.example/v1"), /dedicated variable/);
    process.env.OTHER_KEY = "sk-other";
    assert.equal(resolveApiKey("OTHER_KEY", "https://evil.example/v1").key, "sk-other");
    process.env.ONEVIDEO_KEY_HOSTS = "relay.example";
    assert.equal(resolveApiKey("MANGO_API_KEY", "https://relay.example/v1").key, "sk-test-shared");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("zcode provider config is opt-in", () => {
  const saved = { ...process.env };
  try {
    delete process.env.ONEVIDEO_API_KEY;
    delete process.env.MANGO_API_KEY;
    process.env.HOME = mkdtempSync(join(tmpdir(), "ov-home-"));
    mkdirSync(join(process.env.HOME, ".zcode", "v2"), { recursive: true });
    writeFileSync(join(process.env.HOME, ".zcode", "v2", "provider_config.json"), "provider sk-zcodeproviderfakekey012345");
    delete process.env.ONEVIDEO_ZCODE_PROVIDER;
    assert.equal(resolveApiKey("MANGO_API_KEY", "https://api.mangoqwq.com/v1"), null);
    process.env.ONEVIDEO_ZCODE_PROVIDER = "1";
    assert.equal(resolveApiKey("MANGO_API_KEY", "https://api.mangoqwq.com/v1").key, "sk-zcodeproviderfakekey012345");
    assert.equal(resolveApiKey("MANGO_API_KEY", "https://evil.example/v1"), null);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("render concurrency defaults by cores and memory", async () => {
  const { autoConcurrency } = await import("../cli/commands/render.mjs");
  assert.equal(autoConcurrency(2, 1.9e9), 1);
  assert.equal(autoConcurrency(2, 16e9), 2);
  assert.equal(autoConcurrency(16, 64e9), 4);
  assert.equal(autoConcurrency(8, 4e9), 2);
});

test("render normalizes an extensionless H.264 output before creating its sidecar", async () => {
  const { h264OutputPath } = await import("../cli/commands/render.mjs");
  assert.equal(h264OutputPath("cut"), "cut.mp4");
  assert.equal(h264OutputPath("my.project/cut"), "my.project/cut.mp4");
  assert.equal(h264OutputPath("my.project/cut.mp4"), "my.project/cut.mp4");
});

test("render --aspect keeps a variant's timeline, caption timings and voice files apart", async () => {
  const { withAspect, aspectTag } = await import("../cli/lib/timeline/aspect.mjs");
  const root = "/p";
  const project = { root, config: { name: "demo", aspect: "16:9", width: 1920 }, p: (...xs) => join(root, ...xs), paths: { timeline: "/p/plan/timeline.json", timings: "/p/plan/timings.json", audioDir: "/p/public/audio" } };
  assert.equal(withAspect(project, undefined), project);
  assert.equal(aspectTag("9:16"), "9x16");
  const v = withAspect(project, "9:16");
  assert.equal(v.aspect, "9:16");
  assert.equal(v.config.aspect, "9:16");
  assert.equal(v.config.width, undefined);
  assert.equal(v.paths.timeline, join(root, "plan", "timeline.9x16.json"));
  assert.equal(v.paths.timings, join(root, "plan", "timings.9x16.json"));
  assert.equal(v.paths.audioDir, join(root, "public", "audio", "9x16"));
  assert.equal(v.paths.audioRel, "audio/9x16");
  assert.equal(project.paths.timings, "/p/plan/timings.json");
  assert.throws(() => withAspect(project, "3:2"), /one of 16:9, 9:16, 1:1, 4:5/);
});

// The baseline a fresh project starts from: the motion example compiles with recorded voice
// timings, stand-in media and no rhythm warnings — no TTS, network or render needed.
test("init --example spacex-motion compiles to a rhythm-clean timeline", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ov-smoke-")), "spacex-motion");
  assert.equal(ov(ROOT, "init", dir, "--example", "spacex-motion").status, 0);
  cpSync(join(ROOT, "tests", "fixtures", "spacex-motion-timings.json"), join(dir, "plan", "timings.json"));
  const manifest = json(join(dir, "plan", "assets.json"));
  for (const a of manifest.items) a.file = `assets/${a.id}.${a.kind === "video" ? "mp4" : "jpg"}`;
  writeFileSync(join(dir, "plan", "assets.json"), JSON.stringify(manifest));
  const config = json(join(dir, "onevideo.json"));
  const sfx = ["whoosh-soft", "whoosh-cinematic", "ui-pop", "impact-05", "whoosh", "pop", "success-sting"].map((s) => `sfx/${s}.wav`);
  for (const f of [...manifest.items.map((a) => a.file), ...sfx, config.music.file]) {
    mkdirSync(join(dir, "public", f, ".."), { recursive: true });
    writeFileSync(join(dir, "public", f), "");
  }
  // An empty external store, so a machine with the licensed sfx library picks the same sounds as CI.
  const r = spawnSync(process.execPath, [CLI, "timeline"], { cwd: dir, encoding: "utf8", env: { ...process.env, HOME: dir, ONEVIDEO_LIBRARY_EXT: mkdtempSync(join(tmpdir(), "ov-ext-")) } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /\[rhythm\]/);
  const t = json(join(dir, "plan", "timeline.json"));
  assert.deepEqual(t.scenes.map((s) => s.id).slice(0, 3), ["hook", "ipo", "revenue"]);
  assert.ok(t.duration > 30 && t.duration < 45, `duration ${t.duration}`);
});

test("ONEVIDEO_API_BASE moves the default relay and its key trust to another gateway", () => {
  const saved = { ...process.env };
  try {
    delete process.env.ONEVIDEO_KEY_HOSTS;
    process.env.MANGO_API_KEY = "sk-test-shared";
    process.env.HOME = mkdtempSync(join(tmpdir(), "ov-home-"));
    delete process.env.ONEVIDEO_API_BASE;
    assert.equal(viaApiBase("https://api.mangoqwq.com/v1/audio/speech"), "https://api.mangoqwq.com/v1/audio/speech");
    process.env.ONEVIDEO_API_BASE = "http://10.0.0.5:3000/v1/";
    assert.equal(viaApiBase("https://api.mangoqwq.com/v1/audio/speech"), "http://10.0.0.5:3000/v1/audio/speech");
    assert.equal(viaApiBase("https://example.com/v1/x"), "https://example.com/v1/x");
    assert.equal(resolveApiKey("MANGO_API_KEY", "https://api.mangoqwq.com/v1").key, "sk-test-shared");
    assert.equal(resolveApiKey("MANGO_API_KEY", "http://10.0.0.5:8317/v1").key, "sk-test-shared");
    assert.equal(resolveApiKey("MANGO_API_KEY", "https://api.mangoqwq.com.evil.example/v1"), null);
    assert.equal(resolveApiKey("MANGO_API_KEY", "http://10.0.0.6:3000/v1"), null);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("graphics pipeline: the drawn example compiles with no media, and asset search is refused", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ov-cli-")), "drawn");
  assert.equal(ov(ROOT, "init", dir, "--example", "graphics-demo").status, 0);
  const config = json(join(dir, "onevideo.json"));
  assert.equal(config.pipeline, "graphics");
  assert.equal(config.drawn, true);
  assert.ok(!existsSync(join(dir, "plan", "assets.json")));
  // Caption timings ESTIMATED from the script (no TTS here), with the real line hashes.
  writeFileSync(join(dir, "plan", "timings.json"), JSON.stringify(await estimatedTimings(json(join(dir, "plan", "script.json")), config)));
  const r = ov(dir, "timeline", "--force");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = r.stdout + r.stderr;
  assert.doesNotMatch(out, /\[(drawn|density|schema:\w+|facts|ids)\]/);
  assert.doesNotMatch(out, /consecutive "zoom" transitions/);
  const tl = json(join(dir, "plan", "timeline.json"));
  assert.ok(!JSON.stringify(tl.scenes).includes('"asset"'));
  assert.ok(tl.scenes.some((s) => s.background === "particles"));
  assert.equal(tl.scenes.find((s) => s.id === "travel").transitionIn.type, "cut");
  assert.equal(tl.sfx.find((s) => s.motion === "fly")?.volume, 0.24);

  const sb = json(join(dir, "plan", "storyboard.json"));
  sb.scenes[1].backdrop = { asset: "earth-photo" };
  writeFileSync(join(dir, "plan", "storyboard.json"), JSON.stringify(sb));
  const v = ov(dir, "validate");
  assert.equal(v.status, 1);
  assert.match(v.stdout + v.stderr, /\[drawn\] scene "earth" uses media in a drawn project: backdrop\.asset "earth-photo"/);

  const a = ov(dir, "assets", "suggest", "--no-llm");
  assert.equal(a.status, 1);
  assert.match(a.stderr, /drawn by code \(pipeline graphics\)/);
});

test("keeper example: tableau refs resolve, the world joins by fade or dip, nothing framed badly", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ov-cli-")), "keeper");
  assert.equal(ov(ROOT, "init", dir, "--example", "keeper").status, 0);
  const config = json(join(dir, "onevideo.json"));
  writeFileSync(join(dir, "plan", "timings.json"), JSON.stringify(await estimatedTimings(json(join(dir, "plan", "script.json")), config)));
  const r = ov(dir, "timeline", "--force");
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 0, out);
  assert.doesNotMatch(out, /\[(framing|grounding|drawn|schema:\w+)\]|continues one world/);
  const tl = json(join(dir, "plan", "timeline.json"));
  const fire = tl.scenes.find((s) => s.id === "fire");
  assert.ok(!JSON.stringify(tl.scenes).includes('"on":'));
  assert.ok(fire.props.camera.every((k) => typeof k.x === "number" && typeof k.y === "number"));
  const keeper = fire.props.elements.find((e) => e.id === "keeper"), lh = fire.props.elements.find((e) => e.id === "lh");
  assert.ok(Math.abs(keeper.x - (lh.x + 0.025)) < 1e-3);
  for (const id of ["voyage", "storm", "fire", "home"]) assert.ok(["fade", "dip"].includes(tl.scenes.find((s) => s.id === id).transitionIn.type), id);
  // One world told in six shots is not a variety repeat.
  assert.doesNotMatch(out, /\[variety\]/);
  // The hut set past the cliff's edge again: `fix --apply` puts it back on the rock.
  const sbPath = join(dir, "plan", "storyboard.json"), sb = json(sbPath);
  sb.scenes[0].props.elements.find((e) => e.id === "hut").x = 0.31;
  writeFileSync(sbPath, JSON.stringify(sb));
  const f = ov(dir, "fix", "--apply");
  assert.equal(f.status, 0, f.stdout + f.stderr);
  const hut = json(sbPath).scenes[0].props.elements.find((e) => e.id === "hut");
  assert.ok(hut.x < 0.27, `hut x ${hut.x}`);
  assert.doesNotMatch(ov(dir, "validate").stdout, /\[grounding\]/);
});

test("postman example: an inland world compiles clean, the walker keeps to the nearest ridge", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ov-cli-")), "postman");
  assert.equal(ov(ROOT, "init", dir, "--example", "postman").status, 0);
  const config = json(join(dir, "onevideo.json"));
  writeFileSync(join(dir, "plan", "timings.json"), JSON.stringify(await estimatedTimings(json(join(dir, "plan", "script.json")), config)));
  const r = ov(dir, "timeline", "--force");
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 0, out);
  assert.doesNotMatch(out, /\[(framing|grounding|drawn|cues|variety|schema:\w+)\]|continues one world/);
  const tl = json(join(dir, "plan", "timeline.json"));
  assert.ok(!JSON.stringify(tl.scenes).includes('"on":'));
  const walk = tl.scenes.find((s) => s.id === "walk"), postman = walk.props.elements.find((e) => e.id === "postman");
  const hills = walk.props.elements.find((e) => e.id === "hills");
  assert.deepEqual(postman.follow, { id: "hills", k: hills.layers - 1, dy: 0 });
  for (const t of [0, 4, 8]) {
    const s = stateAt(postman, walk.props.elements, t);
    assert.ok(Math.abs(s.y - ridgeTop(elementAt(hills, t), hills.layers - 1, s.x).y) < 1e-9, `t=${t}`);
  }
  assert.deepEqual(tl.scenes.map((s) => [s.id, s.transitionIn.type]), [
    ["hook", "cut"], ["walk", "cut"], ["snow", "dip"], ["lights", "cut"], ["dawn", "dip"], ["credits", "dip"],
  ]);
});

test("Postman pulls back to the valley before cutting attention back to the lantern", async () => {
  const dir = join(ROOT, "examples", "postman");
  const script = json(join(dir, "plan", "script.json"));
  const storyboard = json(join(dir, "plan", "storyboard.json"));
  for (const aspect of ["16:9", "9:16"]) {
    const config = { ...json(join(dir, "onevideo.json")), aspect };
    const { timeline, errors } = compileTimeline({ config, script, storyboard, timings: await estimatedTimings(script, config) });
    assert.deepEqual(errors, []);
    const lights = timeline.scenes.find((scene) => scene.id === "lights");
    const wide = lights.props.camera.find(({ cue }) => cue === "wide");
    const lantern = lights.props.camera.at(-1);
    assert.ok(wide.t < lights.cues.valley, `${aspect}: pull back as the narrator introduces the whole town`);
    assert.ok(wide.t + wide.dur < lantern.t, `${aspect}: let the valley shot settle before moving to the lantern`);
  }
});

test("Postman's windows light up during the spoken lighting line", async () => {
  const dir = join(ROOT, "examples", "postman");
  const script = json(join(dir, "plan", "script.json"));
  const storyboard = json(join(dir, "plan", "storyboard.json"));
  for (const aspect of ["16:9", "9:16"]) {
    const config = { ...json(join(dir, "onevideo.json")), aspect };
    const { timeline, errors } = compileTimeline({ config, script, storyboard, timings: await estimatedTimings(script, config) });
    assert.deepEqual(errors, []);
    const { cues, lines, props } = timeline.scenes.find((scene) => scene.id === "lights");
    const town = props.elements.find(({ id }) => id === "town");
    const lit = (t) => stateAt(town, props.elements, t).lit;
    const spoken = phraseTime(lines, "点亮了");
    const line = lines.find(({ text }) => text.includes("点亮了"));
    assert.ok(spoken > cues.all && line, `${aspect}: find the spoken lighting line`);
    assert.equal(lit(cues.all), 0, `${aspect}: the windows start dark`);
    assert.ok(lit((cues.all + spoken) / 2) >= 0.25, `${aspect}: the windows visibly start lighting within the line`);
    assert.equal(lit(line.end), 1, `${aspect}: the town is lit before the line ends`);
  }
});

test("Postman shows the whole illuminated town during the valley reveal", async () => {
  const dir = join(ROOT, "examples", "postman");
  const script = json(join(dir, "plan", "script.json"));
  const storyboard = json(join(dir, "plan", "storyboard.json"));
  for (const aspect of ["16:9", "9:16"]) {
    const config = { ...json(join(dir, "onevideo.json")), aspect };
    const { timeline, errors } = compileTimeline({ config, script, storyboard, timings: await estimatedTimings(script, config) });
    assert.deepEqual(errors, []);
    const { cues, props } = timeline.scenes.find((scene) => scene.id === "lights");
    const frame = { W: timeline.width, H: timeline.height };
    const { kx } = stageOf(frame.W, frame.H);
    const town = props.elements.find(({ id }) => id === "town");
    const lantern = props.camera.at(-1);
    for (let t = cues.valley; t < lantern.t; t += 1 / timeline.fps) {
      const { depth, box } = elementGeometry(stateAt(town, props.elements, t), frame);
      const [left, top, right, bottom] = boxOnScreen(cameraAt(props.camera, t), depth, box, kx);
      assert.ok(left >= 0.03 && right <= 0.97 && top >= 0.05 && bottom <= 0.8, aspect + " " + t.toFixed(2) + "s: keep the lit town in frame above the captions");
    }
  }
});

test("Postman stays in frame while he delivers the letters at dawn", async () => {
  const dir = join(ROOT, "examples", "postman");
  const script = json(join(dir, "plan", "script.json"));
  const storyboard = json(join(dir, "plan", "storyboard.json"));
  for (const aspect of ["16:9", "9:16"]) {
    const config = { ...json(join(dir, "onevideo.json")), aspect };
    const { timeline, errors } = compileTimeline({ config, script, storyboard, timings: await estimatedTimings(script, config) });
    assert.deepEqual(errors, []);
    const { cues, duration, props } = timeline.scenes.find((scene) => scene.id === "dawn");
    const frame = { W: timeline.width, H: timeline.height };
    const { kx } = stageOf(frame.W, frame.H);
    const zhou = props.elements.find(({ id }) => id === "zhou");
    for (let t = cues.in; t < duration; t += 1 / timeline.fps) {
      const { depth, box } = elementGeometry(stateAt(zhou, props.elements, t), frame);
      const [left, top, right, bottom] = boxOnScreen(cameraAt(props.camera, t), depth, box, kx);
      assert.ok(left >= 0.05 && right <= 0.95 && top >= 0.05 && bottom <= 0.95, aspect + " " + t.toFixed(2) + "s: keep Zhou inside the frame");
    }
  }
});

test("init --pipeline graphics carries the drawn defaults", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ov-cli-")), "g");
  assert.equal(ov(ROOT, "init", dir, "--pipeline", "graphics").status, 0);
  const c = json(join(dir, "onevideo.json"));
  assert.equal(c.drawn, true);
  assert.equal(c.style, "vector-flow");
  assert.equal(c.gates.minAssetsPerMinute, 0);
  assert.match(ov(dir, "status").stdout, /storyboard/);
  assert.doesNotMatch(ov(dir, "status").stdout, /\bassets\b/);
});
