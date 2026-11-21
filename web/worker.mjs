import { DriveLink, driveVideoPath, proxyVideo } from "./drive.mjs";

// /v/* runs through here (run_worker_first).
// - Videos synced with a Drive backend (videos.json entry `source: "drive"`) are streamed from
//   MangoDrive at play time: see drive.mjs. Secrets: DRIVE_URL (public API base), DRIVE_USER,
//   DRIVE_PASS, DRIVE_ROOT — set by `node web/secrets.mjs`.
// - Everything else is a static asset. Workers static assets answer Range requests with a full 200,
//   which iOS Safari refuses to play and which makes every seek re-download the file, so the first
//   hit loads the asset into the colo's edge cache, and the cache answers Range with proper 206s.
const VIDEO = /^\/v\/([a-z0-9][a-z0-9-]*)\/video\.mp4$/;
const INDEX_TTL = 60_000;
let index = null; // { at, drive: Set<slug> }
let link = null;
const filling = new Set();

export default {
  async fetch(req, env, ctx) {
    const m = VIDEO.exec(new URL(req.url).pathname);
    if (m && (req.method === "GET" || req.method === "HEAD") && (await driveSlugs(env)).has(m[1])) {
      if (req.method === "GET") {
        const hit = await caches.default.match(req);
        if (hit) return hit;
      }
      try {
        link ??= new DriveLink({ url: env.DRIVE_URL, user: env.DRIVE_USER, pass: env.DRIVE_PASS });
        return await proxyVideo(req, { link, path: driveVideoPath(env.DRIVE_ROOT ?? "/onevideo", m[1]), cache: caches.default, defer: (p) => ctx.waitUntil(p), filling, log: (m) => console.log(m) });
      } catch (e) {
        link = null; // drop a client built from bad secrets or holding a dead token
        console.error(`drive ${m[1]}: ${e.message}`);
        return new Response("video unavailable", { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
      }
    }
    return staticAsset(req, env);
  },
};

// Slugs whose video lives on the Drive, from the deployed videos.json (only these are proxied).
async function driveSlugs(env) {
  if (index && Date.now() - index.at < INDEX_TTL) return index.drive;
  let drive = new Set();
  try {
    const res = await env.ASSETS.fetch(new Request("https://assets.local/videos.json"));
    if (res.ok) drive = new Set(((await res.json()).videos ?? []).filter((v) => v.source === "drive").map((v) => v.slug));
  } catch {}
  index = { at: Date.now(), drive };
  return drive;
}

async function staticAsset(req, env) {
  if (req.method !== "GET") return env.ASSETS.fetch(req);
  const cache = caches.default;
  const hit = await cache.match(req);
  if (hit) return hit;

  const res = await env.ASSETS.fetch(new Request(req.url));
  if (res.status !== 200) return res;
  // The binding's response can be chunked with no Content-Length; buffer once to know the size.
  const buf = new Uint8Array(await res.arrayBuffer());
  const headers = new Headers(res.headers);
  headers.set("Content-Length", String(buf.byteLength));
  headers.set("Accept-Ranges", "bytes");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "public, max-age=86400");
  const key = new Request(req.url);
  await cache.put(key, new Response(buf.slice(), { headers }));
  return (await cache.match(req)) ?? rangeResponse(req, buf, headers);
}

// Fallback when the edge cache refused the entry: slice the buffer ourselves.
function rangeResponse(req, buf, headers) {
  const size = buf.byteLength;
  const m = /^bytes=(\d*)-(\d*)$/.exec((req.headers.get("Range") ?? "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return new Response(buf, { headers });
  let start, end;
  if (m[1] === "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" } });
  const h = new Headers(headers);
  h.set("Content-Range", `bytes ${start}-${end}/${size}`);
  h.set("Content-Length", String(end - start + 1));
  return new Response(buf.subarray(start, end + 1), { status: 206, headers: h });
}
