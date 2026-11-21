// Video bytes for the player come from MangoDrive (OpenList): web/sync.mjs uploads each published
// render to <root>/<slug>/web/video.mp4, and the Worker streams it back at play time. The Drive has
// no CORS and its direct links are signed and expire, so the Worker logs in, asks for a fresh link
// and proxies the viewer's Range request; the first hit also fills the edge cache in the background
// so later seeks are answered by the colo. Pure fetch code: runs in the Worker and under node --test.

// The edge in front of the public Drive API turns away non-browser agents on direct links.
export const UA = "Mozilla/5.0 (MangoDrive-consumer; OneVideo)";
export const DRIVE_FILE = "web/video.mp4";
const LINK_TTL = 5 * 60_000; // reuse a signed link this long; a 401/403 from it refreshes early
export const FILL_MAX = 200 * 2 ** 20; // larger files are only proxied, never cached whole

export const driveVideoPath = (root, slug) => `/${[root, slug, DRIVE_FILE].join("/").split("/").filter(Boolean).join("/")}`;

export class DriveLink {
  constructor({ url, user, pass }, fetchFn = fetch, now = Date.now) {
    if (!url || !user || !pass) throw new Error("drive: DRIVE_URL / DRIVE_USER / DRIVE_PASS are not all set");
    this.url = url.replace(/\/+$/, "");
    this.user = user;
    this.pass = pass;
    this.fetch = fetchFn;
    this.now = now;
    this.token = null;
    this.links = new Map(); // path → { url, at }
  }

  async login() {
    const r = await this.fetch(`${this.url}/auth/login`, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/json" }, body: JSON.stringify({ username: this.user, password: this.pass }) });
    const j = await r.json().catch(() => ({}));
    if (j.code !== 200 || !j.data?.token) throw new Error(`drive login failed: ${j.message ?? `HTTP ${r.status}`}`);
    this.token = j.data.token;
  }

  // A signed direct link for the file; cached briefly, `fresh` forces a new one.
  async rawUrl(path, fresh = false, retried = false) {
    const hit = this.links.get(path);
    if (!fresh && hit && this.now() - hit.at < LINK_TTL) return hit.url;
    if (!this.token) await this.login();
    const r = await this.fetch(`${this.url}/fs/get`, { method: "POST", headers: { "User-Agent": UA, Authorization: this.token, "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
    const j = await r.json().catch(() => ({ code: r.status }));
    if ((r.status === 401 || j.code === 401) && !retried) {
      this.token = null;
      return this.rawUrl(path, true, true);
    }
    if (j.code !== 200 || !j.data?.raw_url) throw new Error(`drive /fs/get: ${j.message ?? `code ${j.code}`}`);
    this.links.set(path, { url: j.data.raw_url, at: this.now() });
    return j.data.raw_url;
  }
}

// Stream the Drive file for `req` (GET/HEAD, Range passed through). Returns the response, and on a
// GET schedules a whole-file edge-cache fill under `key` (the request URL without Range) via `defer`.
export async function proxyVideo(req, { link, path, fetchFn = fetch, cache, defer = () => {}, filling = new Set(), fillMax = FILL_MAX }) {
  const range = req.headers.get("Range");
  const upstream = async (fresh, method, withRange) => {
    const headers = { "User-Agent": UA };
    if (withRange && range) headers.Range = range;
    return fetchFn(await link.rawUrl(path, fresh), { method, headers });
  };
  let up = await upstream(false, req.method, true);
  // An expired or revoked sign: get a new link once.
  if (up.status === 401 || up.status === 403 || up.status === 410) up = await upstream(true, req.method, true);
  if (up.status === 416) return new Response(null, { status: 416, headers: pick(up.headers, ["Content-Range"], { "Accept-Ranges": "bytes" }) });
  if (up.status !== 200 && up.status !== 206) {
    up.body?.cancel?.();
    return new Response(`video unavailable (drive HTTP ${up.status})`, { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const headers = pick(up.headers, ["Content-Length", "Content-Range", "ETag", "Last-Modified"], baseHeaders());
  const total = totalSize(up);
  if (req.method === "GET" && cache && total != null && total <= fillMax && !filling.has(req.url)) {
    filling.add(req.url);
    defer(fill(req.url, { upstream, cache, size: total }).finally(() => filling.delete(req.url)));
  }
  return new Response(req.method === "HEAD" ? null : up.body, { status: up.status, headers });
}

// Whole file into the edge cache, so the cache answers later Range requests with 206 itself.
async function fill(url, { upstream, cache, size }) {
  try {
    const up = await upstream(false, "GET", false);
    if (up.status !== 200) { up.body?.cancel?.(); return; }
    const headers = pick(up.headers, ["ETag", "Last-Modified"], baseHeaders());
    headers.set("Content-Length", up.headers.get("Content-Length") ?? String(size));
    await cache.put(new Request(url), new Response(up.body, { status: 200, headers }));
  } catch {
    // Best effort: the next play tries again.
  }
}

const baseHeaders = () => ({ "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" });

function pick(from, names, base = {}) {
  const h = new Headers(base);
  for (const n of names) { const v = from.get(n); if (v != null) h.set(n, v); }
  return h;
}

function totalSize(res) {
  const m = /\/(\d+)\s*$/.exec(res.headers.get("Content-Range") ?? "");
  if (m) return Number(m[1]);
  const n = res.status === 200 ? Number(res.headers.get("Content-Length")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
