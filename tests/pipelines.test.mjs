import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileCaptions, sceneCaptions } from "../cli/lib/captions/index.mjs";
import { compileMusic, ensureMusicBeats, loadMusicGrid, prepareMusic } from "../cli/lib/audio/music.mjs";
import { encodeWav } from "../cli/lib/audio/wav.mjs";
import { synthesize } from "../cli/lib/voice/providers.mjs";
import { ttsConfig } from "../cli/lib/voice/tts.mjs";
import { compileSceneVisuals } from "../cli/lib/assets/compile.mjs";

test("caption placement can change without changing measured narration spans", () => {
  const lines = [{ text: "你好！", start: 0.04, end: 1.2 }];
  const scene = { id: "q", from: 2, type: "quote", props: { text: "你好" }, lines };
  assert.equal(sceneCaptions(scene, lines), false);
  assert.equal(sceneCaptions({ ...scene, captions: true }, lines), true);
  const result = compileCaptions([scene], { style: "karaoke" }, {
    fps: 24,
    place(scenes, items, { fps }) {
      assert.equal(scenes[0], scene);
      assert.equal(fps, 24);
      items[0].top = true;
    },
  });
  assert.deepEqual(result, { enabled: true, style: "karaoke", items: [{ scene: "q", text: "你好！", start: 0.123, end: 1.283, top: true }] });
  assert.deepEqual(lines, [{ text: "你好！", start: 0.04, end: 1.2 }]);
});

test("TTS protocol providers normalize distinct responses to the same WAV contract", async () => {
  const wav = encodeWav({ samples: new Int16Array(80), sampleRate: 8000, channels: 1 });
  const baseUrl = "https://voice.example/v1/";
  const chat = ttsConfig({ tts: { baseUrl, protocol: "chat" } });
  const speech = ttsConfig({ tts: { baseUrl, protocol: "speech", instructions: "plain", speed: 1.1 } });
  assert.deepEqual(await synthesize("Line", chat, null, async (url, opts) => {
    assert.equal(url, "https://voice.example/v1/chat/completions");
    assert.deepEqual(opts.json.messages, [{ role: "assistant", content: "Line" }]);
    return { body: Buffer.from(JSON.stringify({ choices: [{ message: { audio: { data: wav.toString("base64") } } }] })) };
  }), wav);
  assert.deepEqual(await synthesize("Line", speech, null, async (url, opts) => {
    assert.equal(url, "https://voice.example/v1/audio/speech");
    assert.equal(opts.json.input, "Line");
    assert.equal(opts.json.instructions, "plain");
    assert.equal(opts.json.speed, 1.1);
    return { body: wav };
  }), wav);
  await assert.rejects(synthesize("Line", speech, null, async () => ({ body: Buffer.from("invalid") })), /non-WAV/);
});

test("procedural and provided music use the same track and beat-grid contract", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "onevideo-music-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = { root, p: (...parts) => join(root, ...parts), config: {}, paths: { musicDir: join(root, "public", "music") } };
  await prepareMusic(project, { duration: 1 }, {});
  const file = "music/bgm.wav";
  const grid = loadMusicGrid(root, project.config.music);
  assert.equal(grid.source, "synth:ambient");
  const opts = { root, offset: 0.5, grid, scenes: [], warnings: [] };
  const procedural = compileMusic(project.config.music, opts);
  assert.equal(procedural.src, file);
  assert.equal(procedural.credit, "OneVideo 程序化合成");

  project.config.music = { file, credit: "Licensed track" };
  await prepareMusic(project, {}, {});
  assert.deepEqual(await ensureMusicBeats(root, project.config.music), grid);
  assert.deepEqual(compileMusic(project.config.music, opts), { ...procedural, credit: "Licensed track" });
  assert.equal(compileMusic({ enabled: false }, opts), null);
  assert.deepEqual(loadMusicGrid(root, { enabled: false }), {});
  assert.deepEqual(opts.warnings, []);
});

test("each scene resolves its footage, still or generated art to the same visual asset contract", () => {
  const assetById = new Map([
    ["clip", { kind: "video", file: "assets/clip.mp4", license: "CC0" }],
    ["still", { kind: "image", file: "assets/still.jpg", license: "CC0" }],
    ["art", { kind: "image", file: "assets/art.png", license: "generated" }],
  ]);
  const ctx = { assetById, usedAssets: {}, errors: [], warnings: [] };
  const scenes = [
    [{ id: "a", type: "footage" }, { asset: "clip" }],
    [{ id: "b", type: "parallax" }, { asset: "still" }],
    [{ id: "c", type: "quote", backdrop: { asset: "art" } }, {}],
  ];
  const compiled = scenes.map(([scene, props]) => compileSceneVisuals(scene, props, [], ctx));
  assert.deepEqual(compiled.map((scene) => scene.opaque), [true, true, true]);
  assert.deepEqual(compiled[2].backdrop, { asset: "art", blur: 0, dim: 0.62, motion: "in", startFrom: 0 });
  assert.deepEqual(ctx.usedAssets, {
    clip: { kind: "video", src: "assets/clip.mp4", credit: "CC0" },
    still: { kind: "image", src: "assets/still.jpg", credit: "CC0" },
    art: { kind: "image", src: "assets/art.png", credit: null, generated: true },
  });
  assert.deepEqual(ctx.errors, []);
});
