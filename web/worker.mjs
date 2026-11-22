import { DriveLink, directVideo, proxyVideo } from "./drive.mjs";
import { FEEDS } from "./feed.mjs";
import { SHARE, sharePage } from "./share.mjs";

// /v/*, /w/* and the feeds run through here (run_worker_first).
// - /w/<slug> is the player page with that video's share tags (share.mjs).
// - /feed.xml, /sitemap.xml, /robots.txt are built from videos.json for the requested origin (feed.mjs).
// - Videos whose videos.json entry has `source: "drive"` are played straight from MangoDrive: the
//   Worker answers with a 302 to a signed direct link for the drive path that entry names (only those
//   paths: the Worker is no door into the drive). `?via=edge` relays the bytes through the Worker and
//   the edge cache instead — the player's fallback when the direct link fails. See drive.mjs. Secrets DRIVE_URL (public API base), DRIVE_USER, DRIVE_PASS: web/secrets.mjs.
// - Everything else is a static asset. Workers static assets answer Range requests with a full 200,
//   which iOS Safari refuses to play and which makes every seek re-download the file, so the first
//   hit loads the asset into the colo's edge cache, and the cache answers Range with proper 206s.
const VIDEO = /^\/v\/([a-z0-9][a-z0-9-]*)\/video(?:-(\d{3,4}p))?\.mp4$/; // the cut, or a web rendition (video-720p.mp4)
const INDEX_TTL = 60_000;
let index = null; // { at, list, generatedAt, videos: Map<slug, videos.json entry>, drive: Map<slug | slug/<q>, drive path> }
let link = null;
const filling = new Set();

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const share = SHARE.exec(url.pathname);
    if (share && (req.method === "GET" || req.method === "HEAD")) return sharePageResponse(env, share[1], url.origin, req.method);
    const feed = FEEDS[url.pathname];
    if (feed && (req.method === "GET" || req.method === "HEAD")) {
      const { list, generatedAt } = await catalogue(env);
      const body = feed.build(list, url.origin, generatedAt);
      return new Response(req.method === "HEAD" ? null : body, { headers: { "Content-Type": feed.type, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
    }
    const m = VIDEO.exec(url.pathname);
    const path = m && (req.method === "GET" || req.method === "HEAD") ? (await catalogue(env)).drive.get(m[2] ? `${m[1]}/${m[2]}` : m[1]) : null;
    if (path) {
      const relay = url.searchParams.get("via") === "edge";
      if (relay && req.method === "GET") {
        const hit = await caches.default.match(req);
        if (hit) return hit;
      }
      try {
        link ??= new DriveLink({ url: env.DRIVE_URL, user: env.DRIVE_USER, pass: env.DRIVE_PASS });
        if (!relay) return await directVideo(link, path);
        return await proxyVideo(req, { link, path, cache: caches.default, defer: (p) => ctx.waitUntil(p), filling, log: (m) => console.log(m) });
      } catch (e) {
        link = null; // drop a client built from bad secrets or holding a dead token
        console.error(`drive ${m[1]}: ${e.message}`);
        return new Response("video unavailable", { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
      }
    }
    return staticAsset(req, env);
  },
};

// The deployed videos.json: every entry by slug, and the drive path of those that live on the drive.
async function catalogue(env) {
  if (index && Date.now() - index.at < INDEX_TTL) return index;
  let list = [], generatedAt = null;
  try {
    const res = await env.ASSETS.fetch(new Request("https://assets.local/videos.json"));
    if (res.ok) ({ videos: list = [], generatedAt = null } = await res.json());
  } catch {}
  // slug → the cut's drive path, "slug/720p" → that rendition's.
  const drive = new Map();
  const onDrive = (p) => typeof p === "string" && p.startsWith("/");
  for (const v of list) {
    if (v.source !== "drive" || !onDrive(v.drive)) continue;
    drive.set(v.slug, v.drive);
    for (const r of Array.isArray(v.renditions) ? v.renditions : []) if (/^\d{3,4}p$/.test(r?.q ?? "") && onDrive(r.drive)) drive.set(`${v.slug}/${r.q}`, r.drive);
  }
  index = { at: Date.now(), list, generatedAt, videos: new Map(list.map((v) => [v.slug, v])), drive };
  return index;
}

async function sharePageResponse(env, slug, origin, method) {
  const [{ videos }, page] = await Promise.all([catalogue(env), env.ASSETS.fetch(new Request("https://assets.local/"))]);
  if (!page.ok) return page;
  const video = videos.get(slug) ?? null;
  const body = sharePage(await page.text(), video, origin);
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" };
  return new Response(method === "HEAD" ? null : body, { status: video ? 200 : 404, headers });
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
