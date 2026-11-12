import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, utimesSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARCHIVE, Drive, archiveFiles, archiveProject, driveConfig, loadArchive, prunable, restoreProject } from "../cli/lib/archive/index.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");

// An in-memory drive with the client's surface; `corrupt` flips what is read back.
function fakeDrive({ corrupt = new Set() } = {}) {
  const store = new Map();
  return {
    cfg: { root: "/onevideo" },
    store,
    async put(remote, file) { store.set(remote, readFileSync(file)); },
    async download(remote, sink) {
      if (!store.has(remote)) throw new Error(`drive /fs/get: object not found ${remote}`);
      let buf = store.get(remote);
      if (corrupt.has(remote)) buf = Buffer.concat([buf, Buffer.from("x")]);
      if (sink) await new Promise((res, rej) => sink.end(buf, (e) => (e ? rej(e) : res())));
      return { sha256: sha(buf), size: buf.length };
    },
  };
}

function project() {
  const root = mkdtempSync(join(tmpdir(), "ov-arch-"));
  const w = (rel, body) => { mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), body); };
  w("onevideo.json", '{"name":"demo"}');
  w("plan/script.json", "{}");
  for (const v of [1, 2, 3]) w(`out/versions/v${v}.mp4`, `video ${v}`);
  w("out/demo.mp4", "video 3");
  w("out/demo.9x16.mp4", "tall");
  w("out/publish/captions.srt", "1");
  w("out/qc/sheet-01.jpg", "derived");
  w("public/assets/a.jpg", "photo");
  w("public/assets/clip.frames/0001.jpg", "frame");
  w("public/audio/hook.wav", "voice");
  w("public/sfx/boom.wav", "licensed");
  w("public/music/bed.mp3", "licensed");
  return { root, config: { name: "demo" }, w };
}

test("archiveFiles: lasting files only — no frames, QC, library sound, or the main link", () => {
  const p = project();
  const lib = mkdtempSync(join(tmpdir(), "ov-lib-"));
  writeFileSync(join(lib, "s.wav"), "sonniss");
  symlinkSync(join(lib, "s.wav"), join(p.root, "public/assets/s.wav"));
  assert.deepEqual(archiveFiles(p.root, { name: "demo", library: lib }), [
    "onevideo.json", "out/demo.9x16.mp4", "out/publish/captions.srt", "out/versions/v1.mp4", "out/versions/v2.mp4", "out/versions/v3.mp4",
    "plan/script.json", "public/assets/a.jpg", "public/audio/hook.wav",
  ]);
  assert.deepEqual(prunable(["out/versions/v10.mp4", "out/versions/v9.mp4", "out/versions/v2.mp4", "plan/x.json"], 2), ["out/versions/v2.mp4"]);
  // Drafts and partial renders are counted apart from full renders.
  assert.deepEqual(prunable(["out/versions/v1.mp4", "out/versions/v2-draft.mp4", "out/versions/v3-draft.mp4", "out/versions/v4-draft.mp4", "out/versions/v5-part.mp4", "out/versions/v6.mp4"], 2), ["out/versions/v2-draft.mp4"]);
});

test("archiveProject with settle leaves files still being written for the next run", async () => {
  const p = project();
  const old = new Date(Date.now() - 3600e3);
  for (const f of archiveFiles(p.root, { name: "demo" })) utimesSync(join(p.root, f), old, old);
  p.w("out/versions/v4.mp4", "rendering");
  const d = fakeDrive();
  const warns = [];
  const r = await archiveProject(p, { drive: d, settle: 600, warn: (m) => warns.push(m) });
  assert.ok(!r.uploaded.includes("out/versions/v4.mp4"));
  assert.equal(r.uploaded.length, 9);
  assert.match(warns.join(), /1 file\(s\) written in the last 600s/);
  assert.deepEqual((await archiveProject(p, { drive: d })).uploaded, ["out/versions/v4.mp4"]);
});

test("archiveProject uploads, verifies by read-back, skips unchanged, prunes old renders; restore brings them back", async () => {
  const p = project();
  const d = fakeDrive();
  const r1 = await archiveProject(p, { drive: d });
  assert.equal(r1.uploaded.length, 9);
  assert.equal(r1.remote, "/onevideo/demo");
  assert.ok(d.store.has("/onevideo/demo/out/versions/v1.mp4"));
  assert.ok(d.store.has(`/onevideo/demo/${ARCHIVE}`));
  assert.equal(loadArchive(p.root).files["public/audio/hook.wav"].sha256, sha(Buffer.from("voice")));

  p.w("plan/script.json", '{"changed":true}');
  const r2 = await archiveProject(p, { drive: d, prune: true, keep: 2 });
  assert.deepEqual(r2.uploaded, ["plan/script.json"]);
  assert.deepEqual(r2.pruned, ["out/versions/v1.mp4"]);
  assert.ok(!existsSync(join(p.root, "out/versions/v1.mp4")));
  assert.equal(loadArchive(p.root).files["out/versions/v1.mp4"].pruned, true);
  assert.deepEqual((await archiveProject(p, { drive: d })).uploaded, []);

  const back = await restoreProject({ root: p.root, name: "demo", drive: d });
  assert.deepEqual(back.restored, ["out/versions/v1.mp4"]);
  assert.equal(readFileSync(join(p.root, "out/versions/v1.mp4"), "utf8"), "video 1");
  assert.equal(loadArchive(p.root).files["out/versions/v1.mp4"].pruned, undefined);
  assert.deepEqual((await archiveProject(p, { drive: d })).uploaded, []);

  // A fresh machine: everything from the drive alone.
  const fresh = mkdtempSync(join(tmpdir(), "ov-fresh-"));
  const all = await restoreProject({ root: fresh, name: "demo", drive: d });
  assert.equal(all.restored.length, 9);
  assert.equal(readFileSync(join(fresh, "public/assets/a.jpg"), "utf8"), "photo");
});

test("a read-back that differs is not recorded", async () => {
  const p = project();
  const d = fakeDrive({ corrupt: new Set(["/onevideo/demo/onevideo.json"]) });
  await assert.rejects(archiveProject(p, { drive: d }), /onevideo.json: read-back sha256 does not match/);
  assert.equal(loadArchive(p.root).files["onevideo.json"], undefined);
});

test("driveConfig reads only the environment; Drive logs in again once on a 401", async () => {
  assert.equal(driveConfig({}), null);
  assert.throws(() => driveConfig({ ONEVIDEO_DRIVE_URL: "https://d/api" }), /ONEVIDEO_DRIVE_USER/);
  assert.deepEqual(driveConfig({ ONEVIDEO_DRIVE_URL: "https://d/api/", ONEVIDEO_DRIVE_USER: "u", ONEVIDEO_DRIVE_PASS: "p", ONEVIDEO_DRIVE_ROOT: "/x/" }), { url: "https://d/api", user: "u", pass: "p", root: "/x" });

  const calls = [];
  let logins = 0;
  const fetchFn = async (url, opts) => {
    calls.push([url.replace("https://d/api", ""), opts.headers.Authorization ?? null]);
    const body = url.endsWith("/auth/login") ? { code: 200, data: { token: `t${++logins}` } } : opts.headers.Authorization === "t1" ? { code: 401, message: "token expired" } : { code: 200, data: { content: [{ name: "a", is_dir: false, size: 1 }], total: 1 } };
    return { status: 200, ok: true, json: async () => body };
  };
  const d = new Drive({ url: "https://d/api", user: "u", pass: "p", root: "" }, fetchFn);
  assert.deepEqual(await d.list("/"), [{ name: "a", is_dir: false, size: 1 }]);
  assert.deepEqual(calls.map((c) => c.join(" ")), ["/auth/login ", "/fs/list t1", "/auth/login ", "/fs/list t2"]);

  // The public edge turns away a body over its cap with an HTML 413: say where to go instead.
  const capped = new Drive({ url: "https://d/api", user: "u", pass: "p", root: "" }, async (url) =>
    url.endsWith("/auth/login") ? { status: 200, ok: true, json: async () => ({ code: 200, data: { token: "t" } }) } : { status: 413, ok: false, json: async () => { throw new Error("html"); } });
  await assert.rejects(capped.put("/demo/out/versions/v1.mp4", new Blob([new Uint8Array(10)])), /request size cap; point ONEVIDEO_DRIVE_URL at the private-network gateway/);
});
