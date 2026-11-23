#!/usr/bin/env node
// Build the player's catalogue: web/site/videos.json plus each video's poster, captions and
// description under web/site/v/<slug>/. Two sources:
//   drive (default when ONEVIDEO_DRIVE_URL/_USER/_PASS are set): every project on MangoDrive whose
//        archive record lists plan/publish.json and the cut it names (`onevideo publish` on any
//        render node puts them there). Nothing is copied between machines; the cut stays on the
//        drive and the Worker streams it at play time (web/drive.mjs). Files are checked against
//        the archive record's sha256; a project caught mid-upload keeps its previous entry
//        (web/catalog.mjs).
//   host: projects under ONEVIDEO_PROJECTS (default /srv/onevideo) here, or on ONEVIDEO_HOST over
//        ssh; the cut becomes a static asset, so each must be ≤ 25 MiB (over it fails the sync).
//   ONEVIDEO_WEB_FROM=drive|host overrides the choice.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Drive, driveConfig } from "../cli/lib/archive/index.mjs";
import { SLUG, driveCatalogue, entry } from "./catalog.mjs";
import { posterTime } from "../cli/lib/publish/kit.mjs";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "site");
const VDIR = join(SITE, "v");
const MAX_ASSET = 25 * 1024 * 1024; // Workers static assets per-file limit
const KIT = { captions: "out/publish/captions.vtt", description: "out/publish/description.txt" };
const HOST_ASSETS = ["poster.jpg", "captions.vtt", "description.txt"];
const hostVersion = (stamp) => createHash("sha256").update(stamp).digest("hex").slice(0, 12);

async function sync() {
  const drive = driveConfig();
  const from = process.env.ONEVIDEO_WEB_FROM || (drive ? "drive" : "host");
  if (!["drive", "host"].includes(from)) fail(`ONEVIDEO_WEB_FROM must be drive or host (got ${from})`);
  if (from === "drive" && !drive) fail("ONEVIDEO_WEB_FROM=drive needs ONEVIDEO_DRIVE_URL, ONEVIDEO_DRIVE_USER and ONEVIDEO_DRIVE_PASS");

  mkdirSync(VDIR, { recursive: true });
  const previous = new Map((readJsonFile(join(SITE, "videos.json"))?.videos ?? []).map((v) => [v.slug, v]));
  const videos = from === "drive"
    ? await driveCatalogue({ drive: new Drive(drive), root: drive.root, vdir: VDIR, previous, log: console.log, warn: console.warn })
    : fromHost({ previous });

  const keep = new Set(videos.map((v) => v.slug));
  for (const d of readdirSync(VDIR)) if (!keep.has(d)) { rmSync(join(VDIR, d), { recursive: true, force: true }); console.log(`✗ ${d} (no longer published)`); }
  videos.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : a.slug.localeCompare(b.slug)));
  writeFileSync(join(SITE, "videos.json"), JSON.stringify({ generatedAt: new Date().toISOString(), videos }, null, 2));
  console.log(`videos.json: ${videos.length} video(s) from ${from === "drive" ? "MangoDrive" : "the projects on the render host"}`);
}

// ── host ─────────────────────────────────────────────────────────────────────────────────────────
export function fromHost({ root: ROOT = process.env.ONEVIDEO_PROJECTS ?? "/srv/onevideo", host: HOST = process.env.ONEVIDEO_HOST || (existsSync(ROOT) ? "local" : ""), vdir = VDIR, previous = new Map() } = {}) {
  const LOCAL = HOST === "local";
  if (!HOST) fail(`ONEVIDEO_HOST is required off the render node (${ROOT} not found here): set it to its ssh host, e.g. \`ONEVIDEO_HOST=render-box npm run web:sync\`, or configure the drive (ONEVIDEO_DRIVE_*).`);
  // Runs on the host: one JSON line per published project.
  const LIST = `
const fs = require("fs"), path = require("path");
const root = process.argv[2];
for (const slug of fs.readdirSync(root)) {
  const dir = path.join(root, slug);
  try {
    const pub = JSON.parse(fs.readFileSync(path.join(dir, "plan/publish.json"), "utf8"));
    const inProject = (file) => typeof file === "string" && file.startsWith("out/") && !file.split("/").includes("..");
    if (!inProject(pub.video) || (pub.poster && !inProject(pub.poster))) continue;
    const st = fs.statSync(path.join(dir, pub.video), { throwIfNoEntry: false });
    if (!st) console.log(JSON.stringify({ slug, missing: pub.video }));
    else if (st.isFile()) console.log(JSON.stringify({ slug, publish: pub, size: st.size, mtime: st.mtimeMs }));
  } catch {}
}`;
  // ssh joins its arguments into one shell command line; locally the same line goes to bash.
  const ssh = (args, input) => LOCAL
    ? execFileSync("bash", ["-c", args.join(" ")], { input, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] })
    : execFileSync("ssh", [HOST, ...args], { input, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] });
  const scp = (remote, local) => (LOCAL ? copyFileSync(remote, local) : execFileSync("scp", ["-q", `${HOST}:${remote}`, local], { stdio: "inherit" }));
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

  const out = [], tooBig = [];
  for (const p of ssh(["node", "-", q(ROOT)], LIST).split("\n").filter(Boolean).map((l) => JSON.parse(l))) {
    if (!SLUG.test(p.slug)) { console.warn(`skip ${p.slug}: slug must be [a-z0-9-]`); continue; }
    const dst = join(vdir, p.slug);
    const stamp = join(dst, ".synced");
    const hasCopy = (size) => statSync(join(dst, "video.mp4"), { throwIfNoEntry: false })?.size === size
      && HOST_ASSETS.every((f) => existsSync(join(dst, f)));
    if (p.missing) {
      const prev = previous.get(p.slug);
      const cached = readJsonFile(stamp);
      const listed = prev?.source === "static" && cached?.from === "host" && cached.size === prev.size && hasCopy(prev.size);
      const url = `v/${p.slug}/video.mp4?v=`;
      const matches = listed && cached.video === p.missing && prev.video === url + hostVersion(JSON.stringify(cached));
      const legacy = listed && !Object.hasOwn(cached, "video") && Number.isFinite(cached.mtime)
        && prev.video === url + Math.round(cached.mtime).toString(36);
      const keep = matches || legacy;
      const note = legacy ? " — keeping the listed legacy copy; published cut cannot be verified" : keep ? " — keeping the listed version" : "";
      console.warn(`! ${p.slug}: ${p.missing} missing on host${note}`);
      if (keep) out.push(prev);
      continue;
    }
    if (p.size > MAX_ASSET) { tooBig.push(p); continue; }
    const src = `${ROOT}/${p.slug}`;
    const want = JSON.stringify({ video: p.publish.video, poster: p.publish.poster, mtime: p.mtime, size: p.size, from: "host" });
    mkdirSync(dst, { recursive: true });
    const fresh = readText(stamp) === want && hasCopy(p.size);
    if (!fresh) {
      const cut = `${src}/${p.publish.video}`;
      if (p.publish.poster) scp(`${src}/${p.publish.poster}`, join(dst, "poster.jpg"));
      else {
        const ff = "$(find /opt/onevideo/template/node_modules/@remotion -name ffmpeg -type f -perm -u+x | head -1)";
        const tmp = `/tmp/onevideo-poster-${p.slug}.jpg`;
        ssh(["bash", "-c", q(`set -e; ${ff} -v error -y -ss ${posterTime(p.publish).toFixed(2)} -i ${q(cut)} -frames:v 1 -vf scale=1280:-2 -q:v 3 ${tmp}`)]);
        scp(tmp, join(dst, "poster.jpg"));
      }
      scp(cut, join(dst, "video.mp4"));
      scp(`${src}/${KIT.captions}`, join(dst, "captions.vtt"));
      scp(`${src}/${KIT.description}`, join(dst, "description.txt"));
      writeFileSync(stamp, want);
      console.log(`↓ ${p.slug} (${(p.size / 2 ** 20).toFixed(1)} MiB)`);
    } else console.log(`= ${p.slug}`);
    out.push(entry(p.slug, p.publish, {
      size: p.size,
      date: new Date(p.mtime).toISOString().slice(0, 10),
      v: hostVersion(want),
      description: readFileSync(join(dst, "description.txt"), "utf8"),
    }));
  }
  if (tooBig.length) {
    for (const p of tooBig) console.error(`✗ ${p.slug}: ${(p.size / 2 ** 20).toFixed(1)} MiB is over the 25 MiB static asset limit — sync from the drive instead (ONEVIDEO_DRIVE_*)`);
    process.exit(1);
  }
  return out;
}

// ── shared ───────────────────────────────────────────────────────────────────────────────────────
function readText(f) { try { return readFileSync(f, "utf8"); } catch { return null; } }
function readJsonFile(f) { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } }
function fail(msg) { console.error(msg); process.exit(1); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await sync();
