import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateImage, generateVideo, fetchAsset, inspectClip } from "../cli/lib/assets.mjs";
import { ask, parseJsonReply } from "../cli/lib/llm.mjs";
import { request } from "../cli/lib/http.mjs";
import { validateNamed } from "../cli/lib/schema.mjs";
import { sheetPlan, sceneAt, writeSheets } from "../cli/commands/director.mjs";
import { REMOTION_BIN, ffmpeg, ffprobe } from "../cli/lib/ffmpeg.mjs";

// A stand-in relay: `routes[path]` answers (req, body) → [status, json | Buffer]; calls are logged.
async function relay(routes) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : null;
      calls.push({ method: req.method, path: req.url, json, auth: req.headers.authorization });
      const route = Object.entries(routes).find(([p]) => new RegExp(`^${p}$`).test(req.url));
      const [status, out] = route ? route[1](req, json) : [404, { error: "no route" }];
      res.writeHead(status, { "Content-Type": Buffer.isBuffer(out) ? "application/octet-stream" : "application/json" });
      res.end(Buffer.isBuffer(out) ? out : JSON.stringify(out));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.OV_TEST_KEY = "test-key";
  return { base: `http://127.0.0.1:${server.address().port}/v1`, calls, close: () => server.close() };
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const chat = (content) => [200, { choices: [{ message: { content } }] }];

test("image generation falls back to the next model and asks non-OpenAI models for base64", async () => {
  const r = await relay({
    "/v1/images/generations": (_, j) => (j.model === "broken" ? [500, { error: "down" }] : [200, { data: [{ b64_json: PNG.toString("base64") }] }]),
  });
  try {
    const dir = mkdtempSync(join(tmpdir(), "ov-gen-"));
    const item = await generateImage({ id: "dawn", generate: { prompt: "a rocket at dawn" } }, { dir, aspect: "9:16", defaults: { baseUrl: r.base, keyEnv: "OV_TEST_KEY", models: ["broken", "grok-imagine-image"] } });
    assert.equal(item.file, "assets/dawn.png");
    assert.equal(item.author, "grok-imagine-image");
    assert.deepEqual(readFileSync(join(dir, "dawn.png")), PNG);
    const ok = r.calls.find((c) => c.json.model === "grok-imagine-image");
    assert.equal(ok.json.size, "1024x1536");
    assert.equal(ok.json.response_format, "b64_json");
    assert.equal(ok.auth, "Bearer test-key");
    assert.equal(r.calls.find((c) => c.json.model === "broken").json.response_format, "b64_json");
  } finally { r.close(); }
});

test("variants: a vision model picks the take; every take stays on disk", async () => {
  let n = 0;
  const r = await relay({
    "/v1/images/generations": () => [200, { data: [{ b64_json: (n++ === 1 ? PNG : JPG).toString("base64") }] }],
    "/v1/chat/completions": (_, j) => (j.model === "mute" ? chat("") : chat('Sure:\n```json\n{"best": 1, "reason": "clear subject"}\n```')),
  });
  try {
    const dir = mkdtempSync(join(tmpdir(), "ov-gen-"));
    const item = await generateImage({ id: "pad", generate: { prompt: "launch pad", variants: 3, brief: "establishing shot" } }, {
      dir, defaults: { baseUrl: r.base, keyEnv: "OV_TEST_KEY", models: ["gpt-image-2.5"] }, llm: { baseUrl: r.base, keyEnv: "OV_TEST_KEY", models: ["mute", "eyes"] },
    });
    assert.deepEqual(item.takes, ["assets/pad.take0.jpg", "assets/pad.take1.png", "assets/pad.take2.jpg"]);
    assert.equal(item.picked, 1);
    assert.equal(item.pickedBy, "eyes");
    assert.equal(item.file, "assets/pad.png");
    assert.deepEqual(readFileSync(join(dir, "pad.png")), PNG);
    assert.equal(r.calls.find((c) => c.json.model === "gpt-image-2.5").json.response_format, undefined);
    const look = r.calls.find((c) => c.json.model === "eyes");
    assert.equal(look.json.messages[0].content.filter((p) => p.type === "image_url").length, 3);
    assert.match(look.json.messages[0].content[0].text, /establishing shot/);
  } finally { r.close(); }
});

test("a failed generation falls back to the item's stock url", async () => {
  const r = await relay({ "/v1/images/generations": () => [400, { error: "bad prompt" }], "/photo.jpg": () => [200, JPG] });
  try {
    const publicDir = mkdtempSync(join(tmpdir(), "ov-gen-"));
    const warnings = [];
    const item = await fetchAsset({ id: "x", generate: "y", url: r.base.replace("/v1", "/photo.jpg"), license: "CC0" }, { publicDir, gen: { image: { baseUrl: r.base, keyEnv: "OV_TEST_KEY" }, onWarn: (m) => warnings.push(m) } });
    assert.equal(item.via, "url");
    assert.equal(item.file, "assets/x.jpg");
    assert.match(warnings[0], /falling back to url/);
  } finally { r.close(); }
});

test("a clip from a still that fails to generate stands in as the still, and is tried again next fetch", async () => {
  let up = false;
  const r = await relay({
    "/v1/videos": () => (up ? [200, { id: "t1" }] : [429, { error: "rate limited" }]),
    "/v1/videos/t1": () => [500, { error: "down" }],
  });
  try {
    const publicDir = mkdtempSync(join(tmpdir(), "ov-gen-"));
    mkdirSync(join(publicDir, "assets"), { recursive: true });
    writeFileSync(join(publicDir, "assets/pad.png"), PNG);
    const pad = { id: "pad", file: "assets/pad.png", kind: "image", license: "generated", author: "gpt-image-2.5", source: "generated", width: 1536, height: 1024 };
    const warnings = [];
    const gen = { video: { baseUrl: r.base, keyEnv: "OV_TEST_KEY", models: ["v1"], pollSec: 0.01 }, lookup: (id) => (id === "pad" ? pad : null), onWarn: (m) => warnings.push(m) };
    const item = await fetchAsset({ id: "liftoff", kind: "video", generate: { prompt: "liftoff", from: "pad" } }, { publicDir, gen });
    assert.equal(item.kind, "image");
    assert.equal(item.file, "assets/pad.png");
    assert.equal(item.via, "still");
    assert.equal(item.license, "generated");
    assert.equal(item.fallback.from, "pad");
    assert.match(item.fallback.reason, /429/);
    assert.match(warnings[0], /using still "pad"/);
    assert.deepEqual(validateNamed("assets", { items: [pad, item] }), []);
    // Next fetch: generation is attempted again as a video; failing again keeps the still.
    up = true;
    const again = await fetchAsset(item, { publicDir, gen });
    assert.ok(r.calls.filter((c) => c.path === "/v1/videos").length >= 2);
    assert.equal(again.kind, "image");
    assert.equal(again.fallback.from, "pad");
    // Opted out, or no still to stand in: the failure surfaces.
    await assert.rejects(fetchAsset({ id: "x", kind: "video", generate: { prompt: "p", from: "pad", still: false } }, { publicDir, gen: { ...gen } }), /failed on every model/);
    up = false;
    await assert.rejects(fetchAsset({ id: "y", kind: "video", generate: { prompt: "p", from: "nope" } }, { publicDir, gen }), /not fetched yet/);
  } finally { r.close(); }
});

test("ask walks the model list and parses JSON replies", async () => {
  const r = await relay({
    "/v1/chat/completions": (_, j) => (j.model === "gone" ? [500, { error: "no channel" }] : j.model === "blank" ? chat("⚠️ Upstream Gemini returned an empty response.") : chat('{"ok": true, "s": "a } b"}')),
  });
  try {
    const res = await ask({ prompt: "hi", json: true, config: { llm: { baseUrl: r.base, keyEnv: "OV_TEST_KEY", models: ["gone", "blank", "good"] } } });
    assert.deepEqual(res, { data: { ok: true, s: "a } b" }, model: "good" });
    await assert.rejects(ask({ prompt: "hi", config: { llm: { baseUrl: r.base, keyEnv: "OV_TEST_KEY", models: ["gone"] } } }), /no model answered \(gone: HTTP 500/);
    let flaky = 0;
    const r2 = await relay({ "/v1/chat/completions": () => chat(flaky++ ? '{"best": 2}' : "截断的文字") });
    try {
      assert.deepEqual(await ask({ prompt: "hi", json: true, config: { llm: { baseUrl: r2.base, keyEnv: "OV_TEST_KEY", models: ["flaky"] } } }), { data: { best: 2 }, model: "flaky" });
    } finally { r2.close(); }
  } finally { r.close(); }
  assert.deepEqual(parseJsonReply("x [1, [2]] y"), [1, [2]]);
  assert.throws(() => parseJsonReply("nothing here"), /no JSON/);
  // A reply the relay cut off keeps its complete notes.
  const cut = parseJsonReply('```json\n{"score": 6, "notes": [{"cell": 1, "issue": "a"}, {"cell": 2, "issue": "b \\"}\\""}, {"cell": 3, "iss', { partial: true });
  assert.deepEqual(cut.notes.map((n) => n.cell), [1, 2]);
  assert.equal(cut.truncated, true);
  assert.throws(() => parseJsonReply('{"a": [1', { partial: false }), /unterminated/);
});

test("contact sheet geometry and scene lookup", () => {
  assert.deepEqual(sheetPlan(35.4).map((s) => [s.t0, s.cells, s.cols, s.rows]), [[0, 24, 6, 4], [24, 12, 6, 2]]);
  assert.equal(sheetPlan(120)[0].step, 2);
  assert.deepEqual(sheetPlan(10, { fps: 2, from: 4, to: 6 }).map((s) => [s.t0, s.cells, s.cols]), [[4, 4, 4]]);
  const tl = { scenes: [{ id: "a", start: 0 }, { id: "b", start: 11.6 }] };
  assert.equal(sceneAt(tl, 11.6), "b");
  assert.equal(sceneAt(tl, 3), "a");
});

test("video generation: submit, poll, download, cut; image-to-video sends the still", { skip: !existsSync(REMOTION_BIN) && "needs template deps (ffmpeg)" }, async () => {
  const src = join(mkdtempSync(join(tmpdir(), "ov-vid-")), "src.mp4");
  await ffmpeg(["-y", "-f", "lavfi", "-i", "nullsrc=size=320x180:rate=30:duration=2", "-c:v", "libx264", "-preset", "ultrafast", src]);
  const mp4 = readFileSync(src);
  let polls = 0;
  const r = await relay({
    "/v1/videos": (_, j) => [200, { id: j.model === "busy" ? "t-busy" : "t-ok", status: "queued" }],
    "/v1/videos/t-busy": () => [200, { status: "failed", error: { message: "upstream 429: Too many requests" } }],
    "/v1/videos/t-ok": () => [200, { status: ++polls < 2 ? "processing" : "completed" }],
    "/v1/videos/t-ok/content": () => [200, mp4],
  });
  try {
    const publicDir = mkdtempSync(join(tmpdir(), "ov-vid-"));
    mkdirSync(join(publicDir, "assets"));
    writeFileSync(join(publicDir, "assets", "still.jpg"), JPG);
    const warnings = [];
    const item = await generateVideo({ id: "move", kind: "video", generate: { prompt: "push in", from: "still", duration: 4.6 } }, {
      publicDir, aspect: "16:9", onWarn: (m) => warnings.push(m), lookup: (id) => (id === "still" ? { id, file: "assets/still.jpg" } : null),
      defaults: { baseUrl: r.base, keyEnv: "OV_TEST_KEY", models: ["busy", "grok-imagine-video"], pollSec: 0.01 },
    });
    assert.equal(item.file, "assets/move.mp4");
    assert.equal(item.author, "grok-imagine-video");
    assert.equal(item.width, 320);
    assert.match(warnings.join("\n"), /move: clip inspection failed, keeping the whole take/); // this relay has no vision model
    assert.equal(item.inspect, undefined);
    assert.ok(existsSync(join(publicDir, "assets", "move.frames", "0001.jpg")));
    const sub = r.calls.find((c) => c.path === "/v1/videos" && c.json.model === "grok-imagine-video").json;
    assert.equal(sub.duration, 5);
    assert.equal(sub.aspect_ratio, "16:9");
    assert.match(sub.image.url, /^data:image\/jpeg;base64,/);
    await assert.rejects(generateVideo({ id: "m2", kind: "video", generate: { prompt: "p", from: "nope" } }, { publicDir, lookup: () => null, defaults: { baseUrl: r.base, keyEnv: "OV_TEST_KEY" } }), /"nope" is not fetched yet/);
  } finally { r.close(); }
});

test("writeSheets tiles frames into JPEG contact sheets with the bundled ffmpeg", { skip: !existsSync(REMOTION_BIN) && "needs template deps (ffmpeg)" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ov-sheet-"));
  const video = join(dir, "v.mp4");
  await ffmpeg(["-y", "-f", "lavfi", "-i", "nullsrc=size=640x360:rate=25:duration=7", "-c:v", "libx264", "-preset", "ultrafast", video]);
  const { sheets } = await writeSheets(video, join(dir, "qc"), { fps: 1, per: 6, cols: 3, width: 160 });
  assert.deepEqual(sheets.map((s) => [s.cells, s.cols, s.rows]), [[6, 3, 2], [1, 1, 1]]);
  const probe = await ffprobe(sheets[0].file);
  assert.deepEqual([probe.streams[0].width, probe.streams[0].height], [3 * 160 + 4 * 4, 2 * 90 + 3 * 4]);
  assert.equal(readFileSync(sheets[1].file).subarray(0, 2).toString("hex"), "ffd8");
});

test("writeSheets --vs: each cell stacks the other version above this one", { skip: !existsSync(REMOTION_BIN) && "needs template deps (ffmpeg)" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ov-sheet-"));
  const a = join(dir, "a.mp4"), b = join(dir, "b.mp4");
  await ffmpeg(["-y", "-f", "lavfi", "-i", "nullsrc=size=640x360:rate=25:duration=4", "-c:v", "libx264", "-preset", "ultrafast", a]);
  await ffmpeg(["-y", "-f", "lavfi", "-i", "nullsrc=size=640x360:rate=25:duration=2", "-c:v", "libx264", "-preset", "ultrafast", b]);
  mkdirSync(join(dir, "qc"));
  writeFileSync(join(dir, "qc", "compare-09.jpg"), "old");
  const { sheets } = await writeSheets(a, join(dir, "qc"), { fps: 1, cols: 4, width: 160, prefix: "compare", pair: { video: b, shift: 0 } });
  assert.deepEqual(sheets.map((s) => [s.cells, s.cols, s.rows]), [[4, 4, 1]]);
  assert.match(sheets[0].file, /compare-01\.jpg$/);
  assert.ok(!existsSync(join(dir, "qc", "compare-09.jpg")));
  const probe = await ffprobe(sheets[0].file);
  assert.deepEqual([probe.streams[0].width, probe.streams[0].height], [4 * 160 + 5 * 4, (2 * 90 + 4) + 2 * 4]);
});

test("inspectClip: one sheet to the vision model; the longest clean run becomes the clip", { skip: !existsSync(REMOTION_BIN) && "needs template deps (ffmpeg)" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ov-inspect-"));
  const video = join(dir, "take.mp4");
  await ffmpeg(["-y", "-f", "lavfi", "-i", "nullsrc=size=320x180:rate=25:duration=6", "-c:v", "libx264", "-preset", "ultrafast", video]);
  const r = await relay({ "/v1/chat/completions": () => chat('{"score": 6, "issues": [{"cell": 1, "issue": "手部变形"}], "best": {"from": 3, "to": 10}}') });
  try {
    const llm = { baseUrl: r.base, keyEnv: "OV_TEST_KEY", models: ["eyes"] };
    const res = await inspectClip(video, { prompt: "a hand waves", brief: "close-up", llm });
    assert.equal(res.model, "eyes");
    assert.equal(res.score, 6);
    assert.deepEqual(res.issues, [{ t: 0.75, issue: "手部变形" }]); // 12 cells at 2 per second
    assert.deepEqual(res.clip, [1.5, 4]);
    assert.deepEqual((await inspectClip(video, { prompt: "p", keep: 2.5, llm })).clip, [1.5, 2.5]);
    const msg = r.calls[0].json.messages[0].content;
    assert.equal(msg.filter((p) => p.type === "image_url").length, 1);
    assert.match(msg[0].text, /a hand waves[\s\S]*close-up/);
  } finally { r.close(); }
});

test("bodies past curl's config line limit go through a temp file", async () => {
  const r = await relay({ "/v1/echo": (_, j) => [200, { n: j.blob.length }] });
  try {
    for (const n of [100, 200 * 1024, 3 << 20]) {
      const res = await request(`${r.base}/echo`, { method: "POST", json: { blob: "x".repeat(n) }, retries: 0 });
      assert.equal(JSON.parse(res.body.toString()).n, n);
    }
  } finally { r.close(); }
});
