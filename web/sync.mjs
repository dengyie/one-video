#!/usr/bin/env node
// Pull published OneVideo projects from the render host into web/site/v/<slug>/ and write
// web/site/videos.json. Only projects that ran `onevideo publish` (review approved) are listed.
//   ONEVIDEO_HOST      ssh host of the render node; unset on the render node itself (projects root
//                      exists here) or "local" reads the projects directly
//   ONEVIDEO_PROJECTS  projects root on that host     (default: /srv/onevideo)
//   ONEVIDEO_DRIVE_URL / _USER / _PASS / _ROOT   when set, each video is uploaded to MangoDrive
//                      (<root>/<slug>/web/video.mp4, read back and sha256-checked) and the Worker
//                      streams it from there at play time (web/drive.mjs); no size limit. Unset:
//                      videos are static assets, capped at 25 MiB each (over it fails the sync).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Drive, driveConfig, sha256File } from "../cli/lib/archive/index.mjs";
import { driveVideoPath } from "./drive.mjs";

const ROOT = process.env.ONEVIDEO_PROJECTS ?? "/srv/onevideo";
const HOST = process.env.ONEVIDEO_HOST || (existsSync(ROOT) ? "local" : "");
const LOCAL = HOST === "local";
if (!HOST) {
  console.error(`ONEVIDEO_HOST is required off the render node (${ROOT} not found here): set it to its ssh host, e.g. \`ONEVIDEO_HOST=render-box npm run web:sync\`.`);
  process.exit(1);
}
const SITE = join(dirname(fileURLToPath(import.meta.url)), "site");
const MAX_ASSET = 25 * 1024 * 1024; // Workers static assets per-file limit
const DRIVE = driveConfig();
const drive = DRIVE && new Drive(DRIVE);
const source = DRIVE ? "drive" : "static";

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

const remote = ssh(["node", "-", q(ROOT)], LIST).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const vdir = join(SITE, "v");
mkdirSync(vdir, { recursive: true });
const videos = [];
const tooBig = [];

for (const p of remote) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(p.slug)) { console.warn(`skip ${p.slug}: slug must be [a-z0-9-]`); continue; }
  if (source === "static" && p.size > MAX_ASSET) { tooBig.push(p); continue; }
  const src = `${ROOT}/${p.slug}`;
  const dst = join(vdir, p.slug);
  const stamp = join(dst, ".synced");
  const want = JSON.stringify({ mtime: p.mtime, size: p.size, source });
  mkdirSync(dst, { recursive: true });
  const local = join(dst, "video.mp4");
  const fresh = existsSync(stamp) && readFileSync(stamp, "utf8") === want
    && ["poster.jpg", "captions.vtt", "description.txt"].every((f) => existsSync(join(dst, f)))
    && (source === "drive" || statSync(local, { throwIfNoEntry: false })?.size === p.size);
  if (!fresh) {
    const chapters = p.publish.chapters ?? [];
    const at = chapters[1] ? chapters[1].start + 4 : p.publish.duration * 0.2;
    const ff = "$(find /opt/onevideo/template/node_modules/@remotion -name ffmpeg -type f -perm -u+x | head -1)";
    const tmp = `/tmp/onevideo-poster-${p.slug}.jpg`;
    ssh(["bash", "-c", q(`set -e; ${ff} -v error -y -ss ${at.toFixed(2)} -i ${src}/out/${p.name}.mp4 -frames:v 1 -vf scale=1280:-2 -q:v 3 ${tmp}`)]);
    scp(tmp, join(dst, "poster.jpg"));
    if (source === "static") scp(`${src}/out/${p.name}.mp4`, local);
    else {
      rmSync(local, { force: true });
      const file = LOCAL ? `${src}/out/${p.name}.mp4` : join(dst, ".upload.mp4");
      if (!LOCAL) scp(`${src}/out/${p.name}.mp4`, file);
      try { await upload(file, driveVideoPath(DRIVE.root, p.slug)); }
      finally { if (!LOCAL) rmSync(file, { force: true }); }
    }
    scp(`${src}/out/publish/captions.vtt`, join(dst, "captions.vtt"));
    scp(`${src}/out/publish/description.txt`, join(dst, "description.txt"));
    writeFileSync(stamp, want);
    console.log(`↓ ${p.slug} (${(p.size / 2 ** 20).toFixed(1)} MiB${source === "drive" ? " → drive" : ""})`);
  } else console.log(`= ${p.slug}`);
  const v = Math.round(p.mtime).toString(36);
  videos.push({
    slug: p.slug,
    title: p.publish.title,
    summary: p.publish.summary ?? "",
    duration: p.publish.duration,
    chapters: p.publish.chapters ?? [],
    tags: p.publish.tags ?? [],
    date: new Date(p.mtime).toISOString().slice(0, 10),
    source,
    size: p.size,
    video: `v/${p.slug}/video.mp4?v=${v}`,
    poster: `v/${p.slug}/poster.jpg?v=${v}`,
    captions: `v/${p.slug}/captions.vtt?v=${v}`,
    description: readFileSync(join(dst, "description.txt"), "utf8"),
    mtime: p.mtime,
  });
}

const keep = new Set(videos.map((v) => v.slug));
for (const d of readdirSync(vdir)) if (!keep.has(d)) { rmSync(join(vdir, d), { recursive: true, force: true }); console.log(`✗ ${d} (no longer published)`); }

videos.sort((a, b) => b.mtime - a.mtime);
writeFileSync(join(SITE, "videos.json"), JSON.stringify({ generatedAt: new Date().toISOString(), videos: videos.map(({ mtime, ...v }) => v) }, null, 2));
console.log(`videos.json: ${videos.length} video(s)${source === "drive" ? " (streamed from MangoDrive)" : ""}`);
if (tooBig.length) {
  for (const p of tooBig) console.error(`✗ ${p.slug}: ${(p.size / 2 ** 20).toFixed(1)} MiB is over the 25 MiB static asset limit — set ONEVIDEO_DRIVE_URL/_USER/_PASS to serve videos from MangoDrive`);
  process.exit(1);
}

// Upload, then read the file back and compare sha256: a short or corrupt copy would play as a
// truncated video with no error anywhere.
async function upload(file, remote) {
  const local = await sha256File(file);
  await drive.put(remote, file);
  const got = await drive.download(remote);
  if (got.sha256 !== local.sha256 || got.size !== local.size) throw new Error(`drive copy of ${remote} does not match the local file (${got.size} vs ${local.size} bytes)`);
}
