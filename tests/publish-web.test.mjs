import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ladderFor, WEB_LADDER, webArgs, webFile, webRenditions } from "../cli/lib/publish/web.mjs";

test("web ladder: no tier above the cut", () => {
  assert.deepEqual(ladderFor(1080).map((r) => r.q), ["1080p", "720p", "480p"]);
  assert.deepEqual(ladderFor(900).map((r) => r.q), ["720p", "480p"]);
  assert.deepEqual(ladderFor(360), []);
  assert.equal(webFile("720p"), "web-720p.mp4");
});

test("web args: capped bitrate, 2 s keyframes, index at the front", () => {
  const a = webArgs("in.mp4", "out.mp4", WEB_LADDER[1], 30).join(" ");
  assert.match(a, /-vf scale=-2:720:flags=lanczos,format=yuv420p/);
  assert.match(a, /-maxrate 1100k -bufsize 2200k/);
  assert.match(a, /-g 60 -keyint_min 60 -sc_threshold 0/);
  assert.match(a, /-profile:v main/);
  assert.match(a, /-movflags \+faststart out\.mp4$/);
  assert.match(webArgs("i", "o", WEB_LADDER[0], 24).join(" "), /-g 48 /);
  assert.match(webArgs("i", "o", WEB_LADDER[0], 24).join(" "), /-profile:v high/);
});

test("web renditions: encodes missing or stale tiers only", async () => {
  const root = mkdtempSync(join(tmpdir(), "ov-web-"));
  try {
    const dir = join(root, "out/publish");
    mkdirSync(dir, { recursive: true });
    const main = join(root, "out/v4.mp4");
    writeFileSync(main, "CUT");
    const encoded = [];
    const probe = async () => ({ streams: [{ codec_type: "audio" }, { codec_type: "video", height: 1080, avg_frame_rate: "30000/1001" }] });
    const encode = async (args) => { encoded.push(args); writeFileSync(args.at(-1), "ENC"); };
    const out = await webRenditions({ root, main, dir, probe, encode });
    assert.deepEqual(out.map((r) => [r.q, r.kbps, r.file]), [["1080p", 2528, "out/publish/web-1080p.mp4"], ["720p", 1196, "out/publish/web-720p.mp4"], ["480p", 484, "out/publish/web-480p.mp4"]]);
    assert.equal(encoded.length, 3);
    assert.ok(encoded[0].join(" ").includes("-g 60 "), "29.97 fps → 60-frame GOP");

    encoded.length = 0;
    await webRenditions({ root, main, dir, probe, encode });
    assert.equal(encoded.length, 0, "fresh tiers are kept");

    const old = new Date(Date.now() - 60_000);
    utimesSync(join(dir, "web-720p.mp4"), old, old);
    await webRenditions({ root, main, dir, probe, encode });
    assert.deepEqual(encoded.map((a) => a.at(-1)), [join(dir, "web-720p.mp4.part.mp4")]);

    const other = join(root, "out/v5.mp4");
    writeFileSync(other, "NEW");
    utimesSync(other, old, old);
    encoded.length = 0;
    await webRenditions({ root, main: other, dir, probe, encode });
    assert.equal(encoded.length, 3, "older cuts of the same size cannot reuse another cut's tiers");
    assert.ok(encoded.every((args) => args[4] === other));

    encoded.length = 0;
    const probe24 = async () => ({ streams: [{ codec_type: "video", height: 1080, avg_frame_rate: "24/1" }] });
    await webRenditions({ root, main: other, dir, probe: probe24, encode });
    assert.equal(encoded.length, 3, "changed settings invalidate the tiers");

    await assert.rejects(webRenditions({ root, main, dir, probe: async () => ({ streams: [] }), encode }), /no video stream/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
