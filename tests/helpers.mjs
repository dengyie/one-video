import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const EXAMPLE = join(ROOT, "examples", "spacex-ipo");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));

// The SpaceX example plus the timings measured in a real TTS run.
// `media` lists files to create (empty) under a temporary public/, standing in for rendered audio.
export function example({ media = ["sfx/whoosh.wav", "sfx/pop.wav", "music/bgm.wav"] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ov-example-"));
  for (const f of media) {
    mkdirSync(dirname(join(root, "public", f)), { recursive: true });
    writeFileSync(join(root, "public", f), "");
  }
  // The manifest as `assets fetch` leaves it, with empty stand-in files.
  const items = json(join(EXAMPLE, "plan", "assets.json")).items.map((a) => ({ ...a, file: `assets/${a.id}.jpg` }));
  mkdirSync(join(root, "public", "assets"), { recursive: true });
  for (const a of items) writeFileSync(join(root, "public", a.file), "");
  return {
    root,
    config: json(join(EXAMPLE, "onevideo.json")),
    script: json(join(EXAMPLE, "plan", "script.json")),
    storyboard: json(join(EXAMPLE, "plan", "storyboard.json")),
    research: json(join(EXAMPLE, "plan", "research.json")),
    timings: json(join(ROOT, "tests", "fixtures", "spacex-timings.json")),
    fetchedAssets: { items },
  };
}

// Caption timings ESTIMATED from the script (no TTS run): each scene's lines laid end to end at
// about 4.2 spoken units a second with a 0.25s pause between lines. Hashes are the real ones, so the
// timings gate takes them; durations are a guess, good for gate and timeline tests only.
export async function estimatedTimings(script, config) {
  const { sceneSpeech, timingHashes } = await import("../cli/lib/voice/tts.mjs");
  const { spokenLength } = await import("../cli/lib/core/text.mjs");
  const lexicon = { ...(config.lexicon ?? {}), ...(script.lexicon ?? {}) };
  const round = (x) => Math.round(x * 100) / 100;
  const scenes = {};
  for (const scene of script.scenes) {
    const { lines } = sceneSpeech(scene, config, lexicon);
    if (!lines.length) { scenes[scene.id] = { file: null, duration: 0, lines: [] }; continue; }
    const hashes = timingHashes(scene, config, lexicon);
    let t = 0.15;
    const out = lines.map((l, i) => {
      const start = t, end = t + Math.max(0.8, spokenLength(l.speak) / 4.2);
      t = end + 0.25;
      return { text: l.text, speak: l.speak, hash: hashes[i], start: round(start), end: round(end) };
    });
    scenes[scene.id] = { file: `audio/${scene.id}.wav`, duration: round(t + 0.2), lines: out };
  }
  return { sampleRate: 24000, estimated: true, scenes };
}
