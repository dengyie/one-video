#!/usr/bin/env node
// Build the player's catalogue: web/site/videos.json plus each video's poster, captions and
// description under web/site/v/<slug>/. Two sources:
//   drive (default when ONEVIDEO_DRIVE_URL/_USER/_PASS are set): every project on MangoDrive whose
//        archive record lists plan/publish.json and the cut it names (`onevideo publish` on any
//        render node puts them there). Nothing is copied between machines; the cut stays on the
//        drive and the Worker streams it at play time (web/drive.mjs). Files are checked against
//        the archive record's sha256; a project caught mid-upload keeps its previous entry.
//   host: projects under ONEVIDEO_PROJECTS (default /srv/onevideo) here, or on ONEVIDEO_HOST over
//        ssh; the cut becomes a static asset, so each must be ≤ 25 MiB (over it fails the sync).
//   ONEVIDEO_WEB_FROM=drive|host overrides the choice.
import { execFileSync } from "node:child_process";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Drive, driveConfig, joinRemote } from "../cli/lib/archive/index.mjs";
import { posterTime } from "../cli/lib/publish/kit.mjs";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "site");
const VDIR = join(SITE, "v");
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const MAX_ASSET = 25 * 1024 * 1024; // Workers static assets per-file limit
const KIT = { captions: "out/publish/captions.vtt", description: "out/publish/description.txt" };

const DRIVE = driveConfig();
const FROM = process.env.ONEVIDEO_WEB_FROM || (DRIVE ? "drive" : "host");
if (!["drive", "host"].includes(FROM)) fail(`ONEVIDEO_WEB_FROM must be drive or host (got ${FROM})`);
if (FROM === "drive" && !DRIVE) fail("ONEVIDEO_WEB_FROM=drive needs ONEVIDEO_DRIVE_URL, ONEVIDEO_DRIVE_USER and ONEVIDEO_DRIVE_PASS");

mkdirSync(VDIR, { recursive: true });
const previous = new Map((readJsonFile(join(SITE, "videos.json"))?.videos ?? []).map((v) => [v.slug, v]));
const videos = FROM === "drive" ? await fromDrive() : fromHost();

const keep = new Set(videos.map((v) => v.slug));
for (const d of readdirSync(VDIR)) if (!keep.has(d)) { rmSync(join(VDIR, d), { recursive: true, force: true }); console.log(`✗ ${d} (no longer published)`); }
videos.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : a.slug.localeCompare(b.slug)));
writeFileSync(join(SITE, "videos.json"), JSON.stringify({ generatedAt: new Date().toISOString(), videos }, null, 2));
console.log(`videos.json: ${videos.length} video(s) from ${FROM === "drive" ? "MangoDrive" : "the projects on the render host"}`);

// ── drive ────────────────────────────────────────────────────────────────────────────────────────
async function fromDrive() {
  const drive = new Drive(DRIVE);
  const out = [];
  for (const e of await drive.list(DRIVE.root || "/")) {
    if (!e.is_dir || !SLUG.test(e.name)) continue;
    try {
      const v = await driveEntry(drive, e.name);
      if (v) out.push(v);
    } catch (err) {
      // A transient failure (network, an archive run in flight) keeps what the site shows now.
      const prev = previous.get(e.name);
      console.warn(`! ${e.name}: ${err.message}${prev ? " — keeping the listed version" : ""}`);
      if (prev && existsSync(join(VDIR, e.name, "poster.jpg"))) out.push(prev);
    }
  }
  return out;
}

async function driveEntry(drive, slug) {
  const base = joinRemote(DRIVE.root, slug);
  const record = await drive.readJson(joinRemote(base, "plan/archive.json"));
  const files = record?.files ?? {};
  if (!files["plan/publish.json"]) return null; // archived but never published
  const dst = join(VDIR, slug);
  mkdirSync(dst, { recursive: true });
  const pub = JSON.parse(await fetchChecked(drive, base, "plan/publish.json", files, join(dst, ".publish.json")));
  if (!pub.video) throw new Error("plan/publish.json names no cut (published before the player read the drive): run onevideo publish again on its render node");
  if (!pub.poster) throw new Error("plan/publish.json names no poster frame: run onevideo publish again on its render node");
  const need = { video: pub.video, poster: pub.poster, ...KIT };
  for (const [what, rel] of Object.entries(need)) if (!files[rel]?.sha256) throw new Error(`${rel} (${what}) is not in the archive record yet`);

  const stamp = join(dst, ".synced");
  const want = JSON.stringify(Object.values(need).map((rel) => files[rel].sha256).concat(files["plan/publish.json"].sha256));
  const local = { poster: "poster.jpg", captions: "captions.vtt", description: "description.txt" };
  const fresh = readText(stamp) === want && Object.values(local).every((f) => existsSync(join(dst, f)));
  if (!fresh) {
    for (const [what, file] of Object.entries(local)) await fetchChecked(drive, base, need[what], files, join(dst, file));
    writeFileSync(stamp, want);
    console.log(`↓ ${slug} (${pub.video}, ${(files[pub.video].size / 2 ** 20).toFixed(1)} MiB on the drive)`);
  } else console.log(`= ${slug}`);
  const v = files[pub.video].sha256.slice(0, 12);
  return entry(slug, pub, {
    size: files[pub.video].size,
    date: (files[pub.video].at ?? record.at ?? new Date().toISOString()).slice(0, 10),
    v,
    description: readFileSync(join(dst, "description.txt"), "utf8"),
    drive: joinRemote(base, pub.video),
  });
}

// One archived file to a local path, checked against the archive record; returns its text.
async function fetchChecked(drive, base, rel, files, abs) {
  const part = `${abs}.part`;
  const got = await drive.download(joinRemote(base, rel), createWriteStream(part));
  if (got.sha256 !== files[rel].sha256) {
    rmSync(part, { force: true });
    throw new Error(`${rel} on the drive does not match its archive record (an archive run in flight?)`);
  }
  renameSync(part, abs);
  return readFileSync(abs, "utf8");
}

// ── host ─────────────────────────────────────────────────────────────────────────────────────────
function fromHost() {
  const ROOT = process.env.ONEVIDEO_PROJECTS ?? "/srv/onevideo";
  const HOST = process.env.ONEVIDEO_HOST || (existsSync(ROOT) ? "local" : "");
  const LOCAL = HOST === "local";
  if (!HOST) fail(`ONEVIDEO_HOST is required off the render node (${ROOT} not found here): set it to its ssh host, e.g. \`ONEVIDEO_HOST=render-box npm run web:sync\`, or configure the drive (ONEVIDEO_DRIVE_*).`);
  // Runs on the host: one JSON line per published project.
  const LIST = `
const fs = require("fs"), path = require("path");
const root = process.argv[2];
for (const slug of fs.readdirSync(root)) {
  const dir = path.join(root, slug);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, "onevideo.json"), "utf8"));
    const pub = JSON.parse(fs.readFileSync(path.join(dir, "plan/publish.json"), "utf8"));
    const st = fs.statSync(path.join(dir, "out", cfg.name + ".mp4"));
    console.log(JSON.stringify({ slug, name: cfg.name, publish: pub, size: st.size, mtime: st.mtimeMs }));
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
    if (p.size > MAX_ASSET) { tooBig.push(p); continue; }
    const src = `${ROOT}/${p.slug}`;
    const dst = join(VDIR, p.slug);
    const stamp = join(dst, ".synced");
    const want = JSON.stringify({ mtime: p.mtime, size: p.size, from: "host" });
    mkdirSync(dst, { recursive: true });
    const fresh = readText(stamp) === want && statSync(join(dst, "video.mp4"), { throwIfNoEntry: false })?.size === p.size
      && ["poster.jpg", "captions.vtt", "description.txt"].every((f) => existsSync(join(dst, f)));
    if (!fresh) {
      const ff = "$(find /opt/onevideo/template/node_modules/@remotion -name ffmpeg -type f -perm -u+x | head -1)";
      const tmp = `/tmp/onevideo-poster-${p.slug}.jpg`;
      ssh(["bash", "-c", q(`set -e; ${ff} -v error -y -ss ${posterTime(p.publish).toFixed(2)} -i ${src}/out/${p.name}.mp4 -frames:v 1 -vf scale=1280:-2 -q:v 3 ${tmp}`)]);
      scp(tmp, join(dst, "poster.jpg"));
      scp(`${src}/out/${p.name}.mp4`, join(dst, "video.mp4"));
      scp(`${src}/${KIT.captions}`, join(dst, "captions.vtt"));
      scp(`${src}/${KIT.description}`, join(dst, "description.txt"));
      writeFileSync(stamp, want);
      console.log(`↓ ${p.slug} (${(p.size / 2 ** 20).toFixed(1)} MiB)`);
    } else console.log(`= ${p.slug}`);
    out.push(entry(p.slug, p.publish, {
      size: p.size,
      date: new Date(p.mtime).toISOString().slice(0, 10),
      v: Math.round(p.mtime).toString(36),
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
function entry(slug, pub, { size, date, v, description, drive }) {
  return {
    slug,
    title: pub.title,
    summary: pub.summary ?? "",
    duration: pub.duration,
    chapters: pub.chapters ?? [],
    tags: pub.tags ?? [],
    date,
    size,
    video: `v/${slug}/video.mp4?v=${v}`,
    poster: `v/${slug}/poster.jpg?v=${v}`,
    captions: `v/${slug}/captions.vtt?v=${v}`,
    description,
    ...(drive ? { source: "drive", drive } : { source: "static" }),
  };
}

function readText(f) { try { return readFileSync(f, "utf8"); } catch { return null; } }
function readJsonFile(f) { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } }
function fail(msg) { console.error(msg); process.exit(1); }
