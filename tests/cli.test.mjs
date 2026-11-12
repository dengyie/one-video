import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers.mjs";
import { compileTimeline } from "../cli/lib/timeline/index.mjs";
import { resolveApiKey, viaApiBase, requireApiKey } from "../cli/lib/core/http.mjs";
import { reviewSubject } from "../cli/lib/core/state.mjs";

const CLI = join(ROOT, "cli", "onevideo.mjs");
const ov = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, HOME: cwd, ONEVIDEO_WORKERS: "" } });
const json = (p) => JSON.parse(readFileSync(p, "utf8"));

function exampleProject() {
  const dir = join(mkdtempSync(join(tmpdir(), "ov-cli-")), "demo");
  const r = ov(ROOT, "init", dir, "--example", "spacex-ipo");
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

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

test("render --aspect keeps a variant's timeline, caption timings and voice files apart", async () => {
  const { withAspect, aspectTag } = await import("../cli/commands/render.mjs");
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
