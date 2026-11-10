// Real product UI for promo videos: a page opened in a headless Chrome of our own (Remotion's
// bundled chrome-headless-shell, else ONEVIDEO_CHROME / a system Chrome) at a phone, tablet or
// desktop viewport, screenshotted over the DevTools protocol, with the regions a demo will tap or
// open measured as rects. Never attaches to a browser someone is using: it starts its own on a
// free port with a throwaway profile, and stops only that one.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UserError } from "../core/project.mjs";
import { TEMPLATE_DIR } from "../core/ffmpeg.mjs";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
export const VIEWPORTS = {
  phone: { width: 390, height: 844, scale: 3, mobile: true, ua: IPHONE_UA },
  tablet: { width: 820, height: 1180, scale: 2, mobile: true, ua: IPHONE_UA.replace("iPhone; CPU iPhone OS", "iPad; CPU OS") },
  desktop: { width: 1440, height: 900, scale: 2, mobile: false },
};

export function findChrome() {
  if (process.env.ONEVIDEO_CHROME) return process.env.ONEVIDEO_CHROME;
  const shell = join(TEMPLATE_DIR, "node_modules", ".remotion", "chrome-headless-shell");
  if (existsSync(shell)) {
    for (const plat of readdirSync(shell, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const dir = join(shell, plat.name);
      for (const sub of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
        const bin = join(dir, sub, "chrome-headless-shell");
        if (existsSync(bin)) return bin;
      }
    }
  }
  const system = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const hit = system.find((p) => existsSync(p));
  if (hit) return hit;
  throw new UserError("no Chrome found: run a render once (Remotion downloads chrome-headless-shell) or set ONEVIDEO_CHROME");
}

// "name=selector,name2=selector2" → { name: selector }.
export function parseRects(spec) {
  const out = {};
  for (const part of String(spec ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf("=");
    if (i < 1) throw new UserError(`--rects wants name=selector, got "${part}"`);
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// Element boxes (CSS px) → [x, y, w, h] in 0–1 of the captured image, clipped to it.
export function normRects(boxes, width, height) {
  const r = (x) => Math.round(x * 1000) / 1000;
  const out = {};
  for (const [name, b] of Object.entries(boxes)) {
    if (!b) continue;
    const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y), x1 = Math.min(width, b.x + b.w), y1 = Math.min(height, b.y + b.h);
    if (x1 > x0 && y1 > y0) out[name] = [r(x0 / width), r(y0 / height), r((x1 - x0) / width), r((y1 - y0) / height)];
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(bin) {
  const profile = mkdtempSync(join(tmpdir(), "ov-chrome-"));
  const args = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--disable-dev-shm-usage", "--force-color-profile=srgb"];
  if (process.getuid?.() === 0) args.push("--no-sandbox");
  const child = spawn(bin, [...args, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 150 && !existsSync(portFile); i++) {
    if (child.exitCode !== null) break;
    await sleep(100);
  }
  const stop = () => { try { child.kill("SIGKILL"); } catch {} rmSync(profile, { recursive: true, force: true }); };
  if (!existsSync(portFile)) { stop(); throw new Error(`Chrome did not start (${bin}): ${err.trim().split("\n").slice(-3).join(" ")}`); }
  await sleep(50);
  const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
  return { ws: `ws://127.0.0.1:${port}${path}`, stop };
}

// A minimal DevTools client: send(method, params, sessionId) → result; once(event) → params.
function connect(url) {
  if (typeof WebSocket !== "function") throw new UserError("capture needs Node 22+ (global WebSocket)");
  const sock = new WebSocket(url);
  let id = 0;
  const pending = new Map(), waiters = [];
  sock.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject, method } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result);
    } else if (m.method) {
      for (const w of [...waiters]) if (w.method === m.method && (!w.session || w.session === m.sessionId)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m.params); }
    }
  };
  const ready = new Promise((resolve, reject) => { sock.onopen = resolve; sock.onerror = () => reject(new Error("DevTools connection failed")); });
  return {
    ready,
    send: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject, method });
      sock.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
    }),
    once: (method, session, ms = 30000) => new Promise((resolve) => {
      const w = { method, session, resolve };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); resolve(null); } }, ms);
    }),
    close: () => { try { sock.close(); } catch {} },
  };
}

// → { png: Buffer, width, height (image px), rects, viewport }
export async function captureUi({ url, device = "phone", wait = 1500, click = [], rects = {}, full = false, dark = false, chrome } = {}) {
  const vp = VIEWPORTS[device];
  if (!vp) throw new UserError(`unknown device "${device}" (phone, tablet, desktop)`);
  if (!/^(https?|file):/.test(url ?? "")) throw new UserError(`capture wants an http(s) or file: URL, got "${url}"`);
  const browser = await launch(chrome ?? findChrome());
  const cdp = connect(browser.ws);
  try {
    await cdp.ready;
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId: s } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, s);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: vp.scale, mobile: vp.mobile }, s);
    if (vp.mobile) await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true }, s);
    if (vp.ua) await cdp.send("Emulation.setUserAgentOverride", { userAgent: vp.ua }, s);
    if (dark) await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] }, s);
    const loaded = cdp.once("Page.loadEventFired", s, 45000);
    const nav = await cdp.send("Page.navigate", { url }, s);
    if (nav.errorText) throw new UserError(`could not open ${url}: ${nav.errorText}`);
    await loaded;
    const evaluate = async (expression) => {
      const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, s);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    await evaluate("document.fonts ? document.fonts.ready.then(() => true) : true");
    await sleep(wait);
    for (const sel of click) {
      const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true; })()`);
      if (!ok) throw new UserError(`--click: nothing matches "${sel}" on ${url}`);
      await sleep(Math.max(600, wait / 2));
    }
    if (!full) await evaluate("window.scrollTo(0, 0), true");
    const size = await evaluate("({ w: document.documentElement.scrollWidth, h: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) })");
    const W = vp.width, H = full ? Math.max(vp.height, Math.min(size.h, 12000)) : vp.height;
    const boxes = await evaluate(`(() => { const o = {}; for (const [k, sel] of Object.entries(${JSON.stringify(rects)})) { const el = document.querySelector(sel); if (!el) { o[k] = null; continue; } const b = el.getBoundingClientRect(); o[k] = { x: b.left + ${full ? "scrollX" : 0}, y: b.top + ${full ? "scrollY" : 0}, w: b.width, h: b.height }; } return o; })()`);
    const missing = Object.keys(rects).filter((k) => !boxes[k]);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", ...(full ? { captureBeyondViewport: true, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } } : {}) }, s);
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
    return { png: Buffer.from(shot.data, "base64"), width: W * vp.scale, height: H * vp.scale, viewport: [vp.width, vp.height], rects: normRects(boxes, W, H), missing };
  } finally {
    cdp.close();
    browser.stop();
  }
}
