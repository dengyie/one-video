import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
