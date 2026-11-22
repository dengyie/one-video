#!/usr/bin/env node
// Give the Worker its MangoDrive login, from this machine's environment (never printed, never in a
// file): DRIVE_USER / DRIVE_PASS from ONEVIDEO_DRIVE_USER / _PASS, and DRIVE_URL
// from ONEVIDEO_WEB_DRIVE_URL — the Worker runs on Cloudflare's edge, so it needs the public API
// (default https://api-drive.mangoqwq.com/api), not a private-network gateway in ONEVIDEO_DRIVE_URL.
// Run once, and again after the password changes: `node web/secrets.mjs` (Cloudflare env as for deploy).
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driveConfig } from "../cli/lib/archive/index.mjs";

const PUBLIC = "https://api-drive.mangoqwq.com/api";
const cfg = driveConfig({ ...process.env, ONEVIDEO_DRIVE_URL: process.env.ONEVIDEO_WEB_DRIVE_URL || PUBLIC });
const url = new URL(cfg.url);
if (url.protocol !== "https:") { console.error(`DRIVE_URL must be https (got ${url.protocol})`); process.exit(1); }

const secrets = { DRIVE_URL: cfg.url, DRIVE_USER: cfg.user, DRIVE_PASS: cfg.pass };
const r = spawnSync("npx", ["--yes", "wrangler@4.158.0", "secret", "bulk"], {
  cwd: dirname(fileURLToPath(import.meta.url)),
  input: JSON.stringify(secrets),
  stdio: ["pipe", "inherit", "inherit"],
});
if (r.status !== 0) { console.error(`wrangler secret bulk failed (exit ${r.status ?? r.signal})`); process.exit(1); }
console.log(`worker secrets set: ${Object.keys(secrets).join(", ")} (drive host ${url.host})`);
