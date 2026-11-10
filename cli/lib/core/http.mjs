// HTTP via curl: Cloudflare-fronted relays reject Node's fetch fingerprint.
// The curl config (URL, headers, body) goes through stdin so secrets never appear in argv.
import { execFile } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { UserError } from "./project.mjs";

const UA = "OneVideo/0.1 (+https://github.com/dengyie/OneVideo)";

// The relay every default endpoint (TTS, LLM, image, video) talks to. ONEVIDEO_API_BASE points them
// all at another gateway of the same relay (a private network address, say): a URL under the
// public base is rewritten to it, and that gateway's host replaces the public one as trusted.
export const PUBLIC_API_BASE = "https://api.mangoqwq.com/v1";
export const apiBase = () => (process.env.ONEVIDEO_API_BASE || PUBLIC_API_BASE).replace(/\/$/, "");
export const viaApiBase = (url) => (typeof url === "string" && url.startsWith(PUBLIC_API_BASE) ? apiBase() + url.slice(PUBLIC_API_BASE.length) : url);

// ONEVIDEO_API_BASE routes the default relay through another gateway (e.g. a private network
// address of the same relay): requests to PUBLIC_API_BASE are rewritten to it, and its host becomes
// the trusted one. Shared keys (ONEVIDEO_API_KEY, MANGO_API_KEY) are only ever sent to
// trusted hosts; ONEVIDEO_KEY_HOSTS (comma list) extends the default. Any other baseUrl must name
// its own key variable via keyEnv, so a project file cannot redirect the shared key elsewhere.
export const defaultKeyHosts = () => [new URL(apiBase()).hostname.toLowerCase()];
const SHARED_KEY_ENVS = ["ONEVIDEO_API_KEY", "MANGO_API_KEY"];

export function trustedKeyHost(baseUrl) {
  const extra = (process.env.ONEVIDEO_KEY_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  let host;
  try { host = new URL(viaApiBase(baseUrl)).hostname.toLowerCase(); } catch { return false; }
  return [...defaultKeyHosts(), ...extra].includes(host);
}

// Lookup order: keyEnv → ONEVIDEO_API_KEY → MANGO_API_KEY → ~/.zcode provider config
// (trusted hosts only, and only when ONEVIDEO_ZCODE_PROVIDER=1 is explicitly exported).
// The key is never printed; callers only learn where it came from.
export function resolveApiKey(envName, baseUrl) {
  const trusted = trustedKeyHost(baseUrl);
  const names = trusted ? [envName, ...SHARED_KEY_ENVS] : [envName].filter((n) => n && !SHARED_KEY_ENVS.includes(n));
  for (const name of names.filter(Boolean)) {
    if (process.env[name]) return { key: process.env[name], source: `env ${name}` };
  }
  if (!trusted) return null;
  // Opt-in only: never silently harvest keys from a local zcode install — third-party
  // users may have unrelated sk- strings there that must not leak to any relay.
  if (process.env.ONEVIDEO_ZCODE_PROVIDER !== "1") return null;
  const cfg = join(homedir(), ".zcode", "v2", "provider_config.json");
  if (existsSync(cfg)) {
    const m = readFileSync(cfg, "utf8").match(/sk-[A-Za-z0-9]{20,}/);
    if (m) return { key: m[0], source: "~/.zcode/v2/provider_config.json" };
  }
  return null;
}

export function requireApiKey(envName, baseUrl) {
  const k = resolveApiKey(envName, baseUrl);
  if (k) return k.key;
  if (!trustedKeyHost(baseUrl)) {
    const host = (() => { try { return new URL(baseUrl).host; } catch { return String(baseUrl); } })();
    throw new UserError(`no API key for ${host}: shared keys only go to ${defaultKeyHosts().join(", ")}; set keyEnv to a dedicated variable (not ${SHARED_KEY_ENVS.join("/")}) and export it, or add the host to ONEVIDEO_KEY_HOSTS`);
  }
  throw new UserError(`no API key: set ${envName ?? "MANGO_API_KEY"} (or ONEVIDEO_API_KEY)`);
}

const quote = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function runCurl(config, timeoutSec = 180) {
  return new Promise((resolve, reject) => {
    const child = execFile("curl", ["-sS", "-K", "-", "-w", "\n%{http_code}", "-m", String(timeoutSec)], { encoding: "buffer", maxBuffer: 1 << 30 }, (err, stdout, stderr) => {
      if (err && !stdout?.length) return reject(new Error(`curl failed: ${stderr?.toString().trim() || err.message}`));
      const nl = stdout.lastIndexOf(10);
      resolve({ status: Number(stdout.subarray(nl + 1).toString()), body: stdout.subarray(0, nl) });
    });
    child.stdin.end(config);
  });
}

// JSON payloads travel in the config as a quoted data-binary value.
export async function request(url, { method = "GET", headers = {}, json, key, timeoutSec, retries = 3, accept } = {}) {
  url = viaApiBase(url);
  const lines = [`url = ${quote(url)}`, `request = ${quote(method)}`, `user-agent = ${quote(UA)}`, "location"];
  if (key) lines.push(`header = ${quote(`Authorization: Bearer ${key}`)}`);
  if (accept) lines.push(`header = ${quote(`Accept: ${accept}`)}`);
  for (const [k, v] of Object.entries(headers)) lines.push(`header = ${quote(`${k}: ${v}`)}`);
  // Bodies past a few KB (inline images run to megabytes) exceed curl's config line limit, so they go
  // through a private temp file (0600) instead.
  let bodyDir = null;
  if (json !== undefined) {
    const body = JSON.stringify(json);
    lines.push(`header = ${quote("Content-Type: application/json")}`);
    if (body.length > 8 * 1024) {
      bodyDir = mkdtempSync(join(tmpdir(), "ov-body-"));
      writeFileSync(join(bodyDir, "body.json"), body, { mode: 0o600 });
      lines.push(`data-binary = ${quote(`@${join(bodyDir, "body.json")}`)}`);
    } else lines.push(`data-binary = ${quote(body)}`);
  }
  const config = lines.join("\n") + "\n";
  try {
    return await send(url, config, timeoutSec, retries);
  } finally {
    if (bodyDir) rmSync(bodyDir, { recursive: true, force: true });
  }
}

async function send(url, config, timeoutSec, retries) {
  let last;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await runCurl(config, timeoutSec);
      if (res.status >= 200 && res.status < 300) return res;
      last = new Error(`HTTP ${res.status} from ${new URL(url).host}: ${res.body.subarray(0, 300).toString()}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      last = e;
    }
    if (attempt <= retries) await new Promise((r) => setTimeout(r, attempt * 2500));
  }
  throw last;
}

export async function getJson(url, opts) {
  const res = await request(url, { ...opts, accept: "application/json" });
  try {
    return JSON.parse(res.body.toString());
  } catch {
    throw new Error(`non-JSON response from ${url}: ${res.body.subarray(0, 200).toString()}`);
  }
}

export async function download(url, opts) {
  return (await request(url, { timeoutSec: 300, ...opts })).body;
}

// Run tasks with bounded concurrency, preserving result order.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
