import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { recordRender } from "../cli/lib/publish/renders.mjs";
import { fromHost } from "../web/sync.mjs";

test("host sync copies the published version rather than the latest render", () => {
  const root = mkdtempSync(join(tmpdir(), "ov-host-"));
  try {
    const projects = join(root, "projects"), vdir = join(root, "site", "v");
    const put = (rel, body) => {
      const file = join(projects, "demo", rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body);
    };
    put("onevideo.json", JSON.stringify({ name: "demo" }));
    put("out/demo.mp4", "unapproved replacement");
    put("out/versions/v1.mp4", "approved");
    put("out/versions/v2.mp4", "next-cut");
    const at = new Date("2026-01-01T00:00:00Z");
    for (const v of ["v1", "v2"]) utimesSync(join(projects, "demo", "out", "versions", `${v}.mp4`), at, at);
    put("out/publish/poster.jpg", "approved poster");
    put("out/publish/captions.vtt", "WEBVTT");
    put("out/publish/description.txt", "description");
    put("plan/publish.json", JSON.stringify({ title: "Demo", video: "out/versions/v1.mp4", poster: "out/publish/poster.jpg" }));

    const [entry] = fromHost({ root: projects, host: "local", vdir });
    assert.equal(entry.size, Buffer.byteLength("approved"));
    assert.equal(readFileSync(join(vdir, "demo", "video.mp4"), "utf8"), "approved");
    assert.equal(readFileSync(join(vdir, "demo", "poster.jpg"), "utf8"), "approved poster");

    put("plan/publish.json", JSON.stringify({ title: "Demo", video: "out/versions/v2.mp4", poster: "out/publish/poster.jpg" }));
    const [next] = fromHost({ root: projects, host: "local", vdir });
    assert.notEqual(next.video, entry.video);
    assert.equal(readFileSync(join(vdir, "demo", "video.mp4"), "utf8"), "next-cut");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("host sync retains the published site copy after a draft prunes the version", () => {
  const base = mkdtempSync(join(tmpdir(), "ov-host-"));
  try {
    const projects = join(base, "projects"), root = join(projects, "demo"), vdir = join(base, "site", "v");
    const out = join(root, "out"), versions = join(out, "versions"), publish = join(root, "plan", "publish.json");
    const project = { root, paths: { out }, config: { name: "demo", render: { keepVersions: 1 } } };
    const put = (file, body) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body);
    };
    const full = join(versions, "v1.mp4"), main = join(out, "demo.mp4");
    put(full, "approved");
    recordRender(project, { v: 1, file: full }, { alias: main });
    put(join(out, "publish", "poster.jpg"), "approved poster");
    put(join(out, "publish", "captions.vtt"), "WEBVTT");
    put(join(out, "publish", "description.txt"), "description");
    put(publish, JSON.stringify({ title: "Demo", video: "out/versions/v1.mp4", poster: "out/publish/poster.jpg" }));
    const opts = { root: projects, host: "local", vdir };
    const entries = fromHost(opts);
    assert.equal(entries.length, 1);
    const draft = join(versions, "v2-draft.mp4");
    put(draft, "unapproved draft");
    recordRender(project, { v: 2, file: draft, draft: true }, { alias: join(out, "demo.draft.mp4") });
    assert.equal(existsSync(full), false);
    assert.equal(readFileSync(main, "utf8"), "approved", "draft pruning does not remove the main alias");

    const previous = new Map(entries.map((entry) => [entry.slug, entry]));
    assert.deepEqual(fromHost({ ...opts, previous }), entries);
    assert.equal(readFileSync(join(vdir, "demo", "video.mp4"), "utf8"), "approved");
    assert.deepEqual(fromHost(opts), [], "a missing cut cannot be newly listed");

    rmSync(publish);
    assert.deepEqual(fromHost({ ...opts, previous }), [], "removing the publish record still unlists the video");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
