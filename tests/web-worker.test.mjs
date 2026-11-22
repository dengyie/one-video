import { test } from "node:test";
import assert from "node:assert/strict";

// web/worker.mjs end to end with a fake Drive behind the global fetch and a fake ASSETS binding.
const BYTES = new Uint8Array(500).map((_, i) => i % 7);
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push(String(url));
  const json = (b) => new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } });
  if (url.endsWith("/auth/login")) return json({ code: 200, data: { token: "t" } });
  if (url.endsWith("/fs/get")) return json({ code: 200, data: { raw_url: `https://raw.example/d${JSON.parse(init.body).path}?sign=s:9999999999` } });
  if (url.startsWith("https://raw.example/")) {
    const m = /bytes=(\d+)-(\d+)/.exec(init.headers?.Range ?? "");
    if (!m) return new Response(BYTES, { headers: { "Content-Length": "500" } });
    return new Response(BYTES.slice(+m[1], +m[2] + 1), { status: 206, headers: { "Content-Range": `bytes ${m[1]}-${m[2]}/500`, "Content-Length": String(m[2] - m[1] + 1) } });
  }
  throw new Error(`unexpected fetch ${url}`);
};
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => store.set(r.url, res) } };
const { default: worker } = await import("../web/worker.mjs");

const videos = { generatedAt: "2026-11-22T00:00:00Z", videos: [{ slug: "keeper", source: "drive", drive: "/OneVideo/keeper/out/v4.mp4", video: "v/keeper/video.mp4?v=abc" }] };
const env = {
  DRIVE_URL: "https://drive.example/api", DRIVE_USER: "u", DRIVE_PASS: "p",
  ASSETS: { fetch: async (r) => (new URL(r.url).pathname === "/videos.json" ? Response.json(videos) : new Response("static", { status: 404 })) },
};
const ctx = { waitUntil: () => {} };
const get = (path, headers = {}, method = "GET") => worker.fetch(new Request(`https://vedio.example${path}`, { method, headers }), env, ctx);

test("worker: a drive video redirects to the signed link; the Worker does not touch the bytes", async () => {
  for (const method of ["GET", "HEAD"]) {
    const res = await get("/v/keeper/video.mp4?v=abc", { Range: "bytes=0-99" }, method);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("Location"), "https://raw.example/d/OneVideo/keeper/out/v4.mp4?sign=s:9999999999");
    assert.match(res.headers.get("Cache-Control"), /^private/);
  }
  assert.ok(!calls.some((u) => u.startsWith("https://raw.example/")));
});

test("worker: ?via=edge relays the Range through the site", async () => {
  const res = await get("/v/keeper/video.mp4?v=abc&via=edge", { Range: "bytes=10-19" });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("Content-Range"), "bytes 10-19/500");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), BYTES.slice(10, 20));
});

test("worker: a slug that is not on the drive is no door into it", async () => {
  const before = calls.length;
  const res = await get("/v/other/video.mp4");
  assert.notEqual(res.status, 302);
  assert.ok(!calls.slice(before).some((u) => u.includes("/fs/get")));
});
