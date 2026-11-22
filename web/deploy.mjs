#!/usr/bin/env node
// `npm run web:deploy`: sync the catalogue (web/sync.mjs), then deploy the Worker — only when the
// site or the Worker differ from what was last deployed from here, so it can run on a timer
// (onevideo-web.timer) and publish a new video minutes after `onevideo publish`. --force deploys anyway.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = dirname(fileURLToPath(import.meta.url));
const STAMP = join(WEB, ".wrangler", "deployed.sha256");
const force = process.argv.includes("--force");

const sync = spawnSync(process.execPath, [join(WEB, "sync.mjs")], { stdio: "inherit" });
if (sync.status !== 0) { console.error(`sync failed (exit ${sync.status ?? sync.signal}); not deploying`); process.exit(1); }

const now = siteHash();
const last = existsSync(STAMP) ? readFileSync(STAMP, "utf8").trim() : null;
if (!force && now === last) { console.log("site and worker unchanged since the last deploy; nothing to do"); process.exit(0); }

// One retry: Cloudflare's API occasionally fails a deploy that goes through a moment later.
let r;
for (let attempt = 1; attempt <= 2; attempt++) {
  r = spawnSync("npx", ["--yes", "wrangler@4.158.0", "deploy"], { cwd: WEB, stdio: "inherit" });
  if (r.status === 0) break;
  console.error(`wrangler deploy failed (exit ${r.status ?? r.signal})${attempt === 1 ? "; retrying in 30s" : ""}`);
  if (attempt === 1) spawnSync("sleep", ["30"]);
}
if (r.status !== 0) process.exit(1);
mkdirSync(dirname(STAMP), { recursive: true });
writeFileSync(STAMP, now + "\n");

// Everything a deploy ships: the site's files (dotfiles excluded, as .assetsignore does; videos.json
// without its generatedAt) and the Worker's code and config.
function siteHash() {
  const h = createHash("sha256");
  const add = (abs) => {
    const rel = relative(WEB, abs);
    let body = readFileSync(abs);
    if (rel === join("site", "videos.json")) body = Buffer.from(JSON.stringify(JSON.parse(body).videos));
    h.update(`${rel}\0${body.length}\0`).update(body);
  };
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith(".") && e.name !== ".assetsignore") continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && !e.name.endsWith(".part")) add(abs);
    }
  };
  walk(join(WEB, "site"));
  for (const f of readdirSync(WEB).filter((f) => /\.(mjs|jsonc)$/.test(f)).sort()) add(join(WEB, f));
  return h.digest("hex");
}
