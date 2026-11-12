// MangoDrive (an OpenList REST API in front of pooled Google Drives): the remote home for a project's
// renders, publish kit, plan and source media. Paths are relative to the app account's own folder.
// Where it lives and who we are come from the environment only, never from a project file:
//   ONEVIDEO_DRIVE_URL   API base, e.g. https://api-drive.mangoqwq.com/api (public, ≤100 MB a request)
//                        or the private-network gateway (no size cap); ends in /api
//   ONEVIDEO_DRIVE_USER / ONEVIDEO_DRIVE_PASS   the app account
//   ONEVIDEO_DRIVE_ROOT  folder under the account for OneVideo (default "/onevideo")
import { createReadStream, openAsBlob } from "node:fs";
import { createHash } from "node:crypto";
import { UserError } from "../core/project.mjs";

// The edge in front of the public API turns away non-browser agents on direct links.
const UA = "Mozilla/5.0 (MangoDrive-consumer; OneVideo)";

export function driveConfig(env = process.env) {
  if (!env.ONEVIDEO_DRIVE_URL) return null;
  if (!env.ONEVIDEO_DRIVE_USER || !env.ONEVIDEO_DRIVE_PASS) throw new UserError("ONEVIDEO_DRIVE_URL is set but ONEVIDEO_DRIVE_USER / ONEVIDEO_DRIVE_PASS are not");
  const root = `/${String(env.ONEVIDEO_DRIVE_ROOT ?? "onevideo").replace(/^\/+|\/+$/g, "")}`;
  return { url: env.ONEVIDEO_DRIVE_URL.replace(/\/+$/, ""), user: env.ONEVIDEO_DRIVE_USER, pass: env.ONEVIDEO_DRIVE_PASS, root: root === "/" ? "" : root };
}

export const joinRemote = (...parts) => `/${parts.join("/").split("/").filter(Boolean).join("/")}`;

export class Drive {
  constructor(cfg, fetchFn = fetch) {
    this.cfg = cfg;
    this.fetch = fetchFn;
    this.token = null;
  }

  async login() {
    const r = await this.fetch(`${this.cfg.url}/auth/login`, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/json" }, body: JSON.stringify({ username: this.cfg.user, password: this.cfg.pass }) });
    const j = await r.json().catch(() => ({}));
    if (j.code !== 200 || !j.data?.token) throw new UserError(`drive login failed: ${j.message ?? `HTTP ${r.status}`}`);
    this.token = j.data.token;
  }

  // One API call; a 401 (HTTP or in the JSON body: the token ran out) logs in again once.
  async call(path, { method = "POST", json, body, headers = {} } = {}, retried = false) {
    if (!this.token) await this.login();
    const r = await this.fetch(`${this.cfg.url}${path}`, {
      method,
      headers: { "User-Agent": UA, Authorization: this.token, ...(json ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json ? JSON.stringify(json) : body,
    });
    const j = await r.json().catch(() => ({ code: r.status, message: `HTTP ${r.status} (not JSON)` }));
    if ((r.status === 401 || j.code === 401) && !retried) {
      this.token = null;
      return this.call(path, { method, json, body, headers }, true);
    }
    if (j.code !== 200) {
      const e = new Error(`drive ${path}: ${j.message ?? `code ${j.code}`}`);
      e.code = j.code;
      throw e;
    }
    return j.data;
  }

  // Upload a local file (streamed from disk; parent folders are created by the server).
  async put(remote, file) {
    const body = typeof file === "string" ? await openAsBlob(file) : file;
    return this.call("/fs/put", { method: "PUT", body, headers: { "File-Path": encodeURIComponent(remote), "As-Task": "false", "Content-Type": "application/octet-stream" } });
  }

  // Every entry of a folder ([] when it does not exist).
  async list(remote) {
    const out = [];
    for (let page = 1; ; page++) {
      let d;
      try { d = await this.call("/fs/list", { json: { path: remote, page, per_page: 200, refresh: page === 1 } }); }
      catch (e) { if (/not found|failed get obj|object not found/i.test(e.message)) return out; throw e; }
      out.push(...(d.content ?? []));
      if (!d.content?.length || out.length >= (d.total ?? 0)) return out;
    }
  }

  // Files under a folder, recursively, as paths relative to it.
  async walk(remote, prefix = "") {
    const files = [];
    for (const e of await this.list(remote)) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.is_dir) files.push(...(await this.walk(joinRemote(remote, e.name), rel)));
      else files.push({ path: rel, size: e.size });
    }
    return files;
  }

  // The signed direct link, fresh each time (signs expire). Used as given: its path looks doubled
  // for app accounts, and "fixing" it breaks the download.
  async rawUrl(remote) {
    const d = await this.call("/fs/get", { json: { path: remote } });
    if (!d?.raw_url) throw new Error(`drive: no direct link for ${remote}`);
    return d.raw_url;
  }

  // The remote file as a byte stream, hashed on the way: { sha256, size } when it ends.
  // `sink` (a writable) receives the bytes; without one they are only hashed (read-back check).
  async download(remote, sink) {
    const r = await this.fetch(await this.rawUrl(remote), { headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error(`drive download ${remote}: HTTP ${r.status}`);
    const h = createHash("sha256");
    let size = 0;
    for await (const chunk of r.body) {
      h.update(chunk);
      size += chunk.length;
      if (sink && !sink.write(chunk)) await new Promise((res) => sink.once("drain", res));
    }
    if (sink) await new Promise((res, rej) => sink.end((e) => (e ? rej(e) : res())));
    return { sha256: h.digest("hex"), size };
  }

  async remove(dir, names) {
    if (names.length) await this.call("/fs/remove", { json: { dir, names } });
  }
}

export async function sha256File(file) {
  const h = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) { h.update(chunk); size += chunk.length; }
  return { sha256: h.digest("hex"), size };
}
