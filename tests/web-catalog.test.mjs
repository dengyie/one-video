import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driveCatalogue } from "../web/catalog.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");

// A MangoDrive stand-in: `files` maps remote path → content; archive.json is derived from the
// project's files unless `records` overrides it. `serve` can corrupt a download (an upload in flight).
function fakeDrive(files, { serve = (path, body) => body } = {}) {
  const downloads = [];
  return {
    downloads,
    async list(remote) {
      assert.equal(remote, "/OneVideo");
      const names = new Set(Object.keys(files).map((p) => p.split("/")[2]));
      return [...names, "Not_A_Slug"].map((name) => ({ name, is_dir: true })).concat({ name: "readme.txt", is_dir: false });
    },
    async readJson(remote) {
      const body = files[remote];
      return body === undefined ? null : JSON.parse(body);
    },
    async download(remote, sink) {
      downloads.push(remote);
      const body = files[remote];
      if (body === undefined) throw new Error(`404 ${remote}`);
      const out = serve(remote, body);
      await new Promise((resolve, reject) => { sink.on("error", reject); sink.end(out, resolve); });
      return { sha256: sha(out), size: Buffer.byteLength(out) };
    },
  };
}

// One project on the drive: its kit plus an archive record listing each file's sha.
function project(slug, { publish, at = "2026-11-01T00:00:00Z", omit = [], extra = {} } = {}) {
  const base = `/OneVideo/${slug}`;
  const kit = {
    "out/v3.mp4": "MP4DATA",
    "out/publish/poster.jpg": "JPEG",
    "out/publish/captions.vtt": "WEBVTT\n",
    "out/publish/description.txt": `${slug} 的简介`,
    ...extra,
  };
  if (publish !== null) kit["plan/publish.json"] = JSON.stringify(publish ?? {
    title: `${slug} 标题`, summary: "一句话", duration: 42, video: "out/v3.mp4", poster: "out/publish/poster.jpg", rendered: "2026-10-30T08:00:00Z",
  });
  const record = { at, files: {} };
  for (const [rel, body] of Object.entries(kit)) if (!omit.includes(rel)) record.files[rel] = { sha256: sha(body), size: Buffer.byteLength(body), at };
  const out = { [`${base}/plan/archive.json`]: JSON.stringify(record) };
  for (const [rel, body] of Object.entries(kit)) out[`${base}/${rel}`] = body;
  return out;
}

function run(drive, opts = {}) {
  const warns = [];
  return driveCatalogue({ drive, root: "/OneVideo", warn: (m) => warns.push(m), ...opts }).then((videos) => ({ videos, warns }));
}

test("drive catalogue: published projects listed with the drive path, sha version and render date; unpublished skipped", async () => {
  const vdir = mkdtempSync(join(tmpdir(), "ov-cat-"));
  try {
    const drive = fakeDrive({ ...project("keeper"), ...project("draft", { publish: null }) });
    const { videos, warns } = await run(drive, { vdir });
    assert.deepEqual(warns, []);
    assert.equal(videos.length, 1);
    const [v] = videos;
    assert.equal(v.slug, "keeper");
    assert.equal(v.title, "keeper 标题");
    assert.equal(v.source, "drive");
    assert.equal(v.drive, "/OneVideo/keeper/out/v3.mp4");
    assert.equal(v.date, "2026-10-30"); // publish.rendered, not the upload time
    assert.equal(v.size, 7);
    assert.equal(v.video, `v/keeper/video.mp4?v=${sha("MP4DATA").slice(0, 12)}`);
    assert.equal(v.description, "keeper 的简介");
    for (const f of ["poster.jpg", "captions.vtt", "description.txt", ".synced"]) assert.ok(existsSync(join(vdir, "keeper", f)), f);
    assert.equal(readFileSync(join(vdir, "keeper", "poster.jpg"), "utf8"), "JPEG");
    assert.ok(!drive.downloads.some((p) => p.endsWith(".mp4")), "the cut stays on the drive");
    assert.ok(!existsSync(join(vdir, "draft")), "an unpublished project leaves nothing behind");

    // Second run: the stamp matches, only publish.json is fetched again.
    drive.downloads.length = 0;
    const again = await run(drive, { vdir });
    assert.deepEqual(again.videos, videos);
    assert.deepEqual(drive.downloads, ["/OneVideo/keeper/plan/publish.json"]);
  } finally { rmSync(vdir, { recursive: true, force: true }); }
});

test("drive catalogue: a file that does not match its record keeps the listed entry; no cut is an error", async () => {
  const vdir = mkdtempSync(join(tmpdir(), "ov-cat-"));
  try {
    const files = { ...project("keeper"), ...project("old", { publish: { title: "旧", poster: "out/publish/poster.jpg" } }) };
    const first = await run(fakeDrive(files), { vdir });
    assert.deepEqual(first.videos.map((v) => v.slug), ["keeper"]);
    assert.match(first.warns.join("\n"), /old: plan\/publish\.json names no cut/);
    assert.ok(!existsSync(join(vdir, "old")), "a project that fails before it was ever listed leaves no directory (sync would delete it every run)");

    // The poster on the drive changed under its record (an archive run in flight): keep what is listed.
    files["/OneVideo/keeper/out/publish/poster.jpg"] = "NEWJPEG";
    const rec = JSON.parse(files["/OneVideo/keeper/plan/archive.json"]);
    rec.files["out/publish/poster.jpg"].sha256 = sha("NEWJPEG");
    files["/OneVideo/keeper/plan/archive.json"] = JSON.stringify(rec);
    const torn = fakeDrive(files, { serve: (p, body) => (p.endsWith("poster.jpg") ? "HALF" : body) });
    const previous = new Map(first.videos.map((v) => [v.slug, v]));
    const second = await run(torn, { vdir, previous });
    assert.deepEqual(second.videos, first.videos);
    assert.match(second.warns.join("\n"), /keeper: out\/publish\/poster\.jpg on the drive does not match its archive record .*keeping the listed version/);
    assert.equal(readFileSync(join(vdir, "keeper", "poster.jpg"), "utf8"), "JPEG", "the good poster is not replaced");
    assert.ok(!existsSync(join(vdir, "keeper", "poster.jpg.part")));

    // Without a previous entry the project is simply not listed.
    const fresh = await run(torn, { vdir: join(vdir, "elsewhere") });
    assert.deepEqual(fresh.videos, []);
  } finally { rmSync(vdir, { recursive: true, force: true }); }
});

test("drive catalogue: late failure leaves every file of the previous kit intact", async () => {
  const vdir = mkdtempSync(join(tmpdir(), "ov-cat-"));
  try {
    const { videos } = await run(fakeDrive(project("keeper")), { vdir });
    const previous = new Map(videos.map((v) => [v.slug, v]));
    const dir = join(vdir, "keeper");
    const snapshot = () => Object.fromEntries(readdirSync(dir).map((file) => [file, readFileSync(join(dir, file), "utf8")]));
    const before = snapshot();
    const update = project("keeper", {
      publish: { title: "new", video: "out/v3.mp4", poster: "out/publish/poster.jpg" },
      extra: { "out/v3.mp4": "NEWCUT", "out/publish/poster.jpg": "NEWJPEG", "out/publish/captions.vtt": "WEBVTT\nnew" },
    });
    const after = await run(fakeDrive(update, { serve: (p, body) => p.endsWith(".vtt") ? "HALF" : body }), { vdir, previous });
    assert.deepEqual(after.videos, videos);
    assert.match(after.warns.join("\n"), /captions\.vtt.*keeping the listed version/);
    assert.deepEqual(snapshot(), before);

    const retry = await run(fakeDrive(update), { vdir, previous });
    assert.equal(retry.videos[0].title, "new");
    assert.equal(readFileSync(join(dir, "poster.jpg"), "utf8"), "NEWJPEG");
  } finally { rmSync(vdir, { recursive: true, force: true }); }
});

test("drive catalogue: a kit file missing from the archive record is reported, not guessed", async () => {
  const vdir = mkdtempSync(join(tmpdir(), "ov-cat-"));
  try {
    const { videos, warns } = await run(fakeDrive(project("keeper", { omit: ["out/publish/captions.vtt"] })), { vdir });
    assert.deepEqual(videos, []);
    assert.match(warns.join("\n"), /captions\.vtt \(captions\) is not in the archive record yet/);
  } finally { rmSync(vdir, { recursive: true, force: true }); }
});

test("drive catalogue: web renditions on the drive are listed highest first; one not uploaded yet is left out", async () => {
  const vdir = mkdtempSync(join(tmpdir(), "ov-cat-"));
  try {
    const publish = {
      title: "k", duration: 42, video: "out/v3.mp4", poster: "out/publish/poster.jpg",
      renditions: [
        { q: "480p", height: 480, kbps: 484, file: "out/publish/web-480p.mp4" },
        { q: "1080p", height: 1080, kbps: 2528, file: "out/publish/web-1080p.mp4" },
        { q: "720p", height: 720, kbps: 1196, file: "out/publish/web-720p.mp4" },
        { q: "../x", height: 1, kbps: 1, file: "out/v3.mp4" },
      ],
    };
    const extra = { "out/publish/web-480p.mp4": "W480", "out/publish/web-720p.mp4": "W720P" };
    const drive = fakeDrive(project("keeper", { publish, extra }));
    const { videos, warns } = await run(drive, { vdir });
    assert.deepEqual(warns, []);
    assert.deepEqual(videos[0].renditions, [
      { q: "720p", height: 720, kbps: 1196, size: 5, video: `v/keeper/video-720p.mp4?v=${sha("W720P").slice(0, 12)}`, drive: "/OneVideo/keeper/out/publish/web-720p.mp4" },
      { q: "480p", height: 480, kbps: 484, size: 4, video: `v/keeper/video-480p.mp4?v=${sha("W480").slice(0, 12)}`, drive: "/OneVideo/keeper/out/publish/web-480p.mp4" },
    ]);
    assert.ok(!drive.downloads.some((p) => p.endsWith(".mp4")), "renditions stay on the drive too");
  } finally { rmSync(vdir, { recursive: true, force: true }); }
});
