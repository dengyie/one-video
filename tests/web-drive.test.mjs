import { test } from "node:test";
import assert from "node:assert/strict";
import { DriveLink, proxyVideo, UA } from "../web/drive.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const BYTES = new Uint8Array(1000).map((_, i) => i % 251);

// A fake Drive: login, /fs/get (signed link with a counter), and the raw link honouring Range.
function fakeDrive({ expireFirstLink = false, rawStatus } = {}) {
  const calls = [];
  let signs = 0;
  let token = "t1";
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/auth/login")) return json({ code: 200, data: { token } });
    if (url.endsWith("/fs/get")) {
      if (init.headers.Authorization !== token) return json({ code: 401, message: "token expired" });
      signs++;
      return json({ code: 200, data: { raw_url: `https://raw.example/d${JSON.parse(init.body).path}?sign=${signs}` } });
    }
    if (url.startsWith("https://raw.example/")) {
      assert.equal(init.headers["User-Agent"], UA);
      if (rawStatus) return new Response("nope", { status: rawStatus });
      if (expireFirstLink && url.endsWith("sign=1")) return new Response("expired", { status: 403 });
      const range = init.headers.Range;
      const size = BYTES.length;
      if (!range) return new Response(init.method === "HEAD" ? null : BYTES, { status: 200, headers: { "Content-Length": String(size), "Set-Cookie": "x=1" } });
      const [, a, b] = /bytes=(\d+)-(\d*)/.exec(range);
      const start = Number(a), end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
      if (start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      return new Response(BYTES.slice(start, end + 1), { status: 206, headers: { "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetchFn, calls, setToken: (t) => (token = t) };
}

const fakeCache = () => {
  const store = new Map();
  return { store, put: async (req, res) => store.set(req.url, new Uint8Array(await res.arrayBuffer())) };
};

const req = (headers = {}, method = "GET") => new Request("https://vedio.example/v/keeper/video.mp4?v=abc", { method, headers });

test("a Range request is proxied as a 206 with the Drive's Content-Range, and fills the cache whole", async () => {
  const d = fakeDrive();
  const link = new DriveLink({ url: "https://drive.example/api/", user: "u", pass: "p" }, d.fetchFn);
  const cache = fakeCache();
  const deferred = [];
  const res = await proxyVideo(req({ Range: "bytes=100-199" }), { link, path: "/keeper/out/versions/v4.mp4", fetchFn: d.fetchFn, cache, defer: (p) => deferred.push(p) });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("Content-Range"), "bytes 100-199/1000");
  assert.equal(res.headers.get("Content-Type"), "video/mp4");
  assert.equal(res.headers.get("Accept-Ranges"), "bytes");
  assert.equal(res.headers.get("Set-Cookie"), null);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), BYTES.slice(100, 200));
  await Promise.all(deferred);
  assert.deepEqual(cache.store.get("https://vedio.example/v/keeper/video.mp4?v=abc"), BYTES);
  // Logged in once; the signed link was reused for the fill.
  assert.equal(d.calls.filter((c) => c.url.endsWith("/auth/login")).length, 1);
  assert.equal(d.calls.filter((c) => c.url.endsWith("/fs/get")).length, 1);
});

test("an expired sign is refreshed once; an expired token logs in again", async () => {
  const d = fakeDrive({ expireFirstLink: true });
  const link = new DriveLink({ url: "https://drive.example/api", user: "u", pass: "p" }, d.fetchFn);
  const res = await proxyVideo(req({ Range: "bytes=0-9" }), { link, path: "/p", fetchFn: d.fetchFn });
  assert.equal(res.status, 206);
  assert.equal(d.calls.filter((c) => c.url.endsWith("/fs/get")).length, 2);

  d.setToken("t2");
  link.links.clear();
  assert.match(await link.rawUrl("/p"), /sign=3$/);
  assert.equal(d.calls.filter((c) => c.url.endsWith("/auth/login")).length, 2);
});

test("HEAD has no body, out-of-range is 416, Drive errors are 502", async () => {
  const d = fakeDrive();
  const link = new DriveLink({ url: "https://drive.example/api", user: "u", pass: "p" }, d.fetchFn);
  const head = await proxyVideo(req({}, "HEAD"), { link, path: "/p", fetchFn: d.fetchFn });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("Content-Length"), "1000");
  assert.equal(head.body, null);

  const far = await proxyVideo(req({ Range: "bytes=5000-" }), { link, path: "/p", fetchFn: d.fetchFn });
  assert.equal(far.status, 416);
  assert.equal(far.headers.get("Content-Range"), "bytes */1000");

  const bad = fakeDrive({ rawStatus: 500 });
  const res = await proxyVideo(req(), { link: new DriveLink({ url: "https://drive.example/api", user: "u", pass: "p" }, bad.fetchFn), path: "/p", fetchFn: bad.fetchFn });
  assert.equal(res.status, 502);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("files over the fill limit are proxied but never cached whole; one fill per URL at a time", async () => {
  const d = fakeDrive();
  const link = new DriveLink({ url: "https://drive.example/api", user: "u", pass: "p" }, d.fetchFn);
  const deferred = [];
  await proxyVideo(req({ Range: "bytes=0-9" }), { link, path: "/p", fetchFn: d.fetchFn, cache: fakeCache(), defer: (p) => deferred.push(p), fillMax: 999 });
  assert.equal(deferred.length, 0);

  const filling = new Set(["https://vedio.example/v/keeper/video.mp4?v=abc"]);
  await proxyVideo(req({ Range: "bytes=0-9" }), { link, path: "/p", fetchFn: d.fetchFn, cache: fakeCache(), defer: (p) => deferred.push(p), filling });
  assert.equal(deferred.length, 0);
});

test("missing secrets fail loudly", () => {
  assert.throws(() => new DriveLink({ url: "https://x", user: "", pass: "p" }), /DRIVE_URL \/ DRIVE_USER \/ DRIVE_PASS/);
});

test("the default fetch is not called as a method (Workers throws Illegal invocation)", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = function (url) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return Promise.resolve(json({ code: 200, data: { token: "t" } }));
  };
  try { await new DriveLink({ url: "https://drive.example/api", user: "u", pass: "p" }).login(); }
  finally { globalThis.fetch = real; }
});
