// Caption timings for another frame (--aspect 9:16) without the audio: a narrow frame cuts the
// narration into shorter caption lines, but in scene unit it speaks the very same audio, so the
// variant's lines are placed on the main timings instead of on a fresh pause search. A variant
// boundary that falls on a main line boundary takes that pause exactly; one inside a main line is
// placed by its share of the line's spoken length. The scene file and duration are the main ones.
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { log, readJson, writeJson } from "../core/project.mjs";
import { normalizeForMatch, spokenLength } from "../core/text.mjs";
import { runTts, sceneSpeech, timingHashes, timingLinesMatch, timingVoice } from "./tts.mjs";

const round = (x) => Math.round(x * 1000) / 1000;
const audioHash = (hashes) => (hashes[0] ?? "").split(".")[0];

// [start, end] of each variant line, given the main lines' spans: both cut the same text, matched
// character by character after punctuation and spaces are dropped. null when the texts differ.
export function respan(main, variant) {
  const key = (lines) => lines.map((l) => normalizeForMatch(l.text)).join("");
  if (key(main) !== key(variant)) return null;
  // Main line k covers characters [c0, c1); within it time runs with the spoken length so far.
  const segs = [];
  let c = 0;
  for (const l of main) {
    const chars = [...normalizeForMatch(l.text)];
    const weight = chars.map((ch) => Math.max(0.5, spokenLength(ch)));
    segs.push({ c0: c, c1: c + chars.length, start: l.start, end: l.end, weight, total: weight.reduce((a, b) => a + b, 0) || 1 });
    c += chars.length;
  }
  const timeAt = (pos, side) => {
    const k = side === "start" ? segs.findIndex((s) => pos >= s.c0 && pos < s.c1) : segs.findIndex((s) => pos > s.c0 && pos <= s.c1);
    const s = segs[k === -1 ? (side === "start" ? 0 : segs.length - 1) : k];
    if (pos <= s.c0) return s.start;
    if (pos >= s.c1) return s.end;
    const done = s.weight.slice(0, pos - s.c0).reduce((a, b) => a + b, 0);
    return s.start + ((s.end - s.start) * done) / s.total;
  };
  const out = [];
  let pos = 0;
  for (const l of variant) {
    const n = [...normalizeForMatch(l.text)].length;
    const start = timeAt(pos, "start"), end = Math.max(start, timeAt(pos + n, "end"));
    out.push([round(start), round(end)]);
    pos += n;
  }
  return out;
}

// The variant timings from the main ones, or null when some scene speaks different audio in the
// variant (line unit with a different cut, or explicit lines spoken differently) or the main
// timings miss a scene: then only a real tts run can time it.
export function variantTimings(script, mainTimings, mainConfig, config) {
  const t = timingVoice(config, mainTimings.voice);
  const mainVoice = timingVoice(mainConfig, mainTimings.voice);
  if (!t || !mainVoice) return null;
  const lexicon = { ...(config.lexicon ?? {}), ...(script.lexicon ?? {}) };
  const mainLex = { ...(mainConfig.lexicon ?? {}), ...(script.lexicon ?? {}) };
  const out = { ...mainTimings, scenes: {}, derivedFrom: "plan/timings.json" };
  for (const scene of script.scenes) {
    const main = mainTimings.scenes?.[scene.id];
    const hashes = timingHashes(scene, config, lexicon, t);
    if (!hashes.length) { out.scenes[scene.id] = main ?? { file: null, duration: 0, lines: [] }; continue; }
    if (!main?.lines?.length) return null;
    const { lines } = sceneSpeech(scene, config, lexicon);
    const have = main.lines.map((l) => l.hash);
    if (timingLinesMatch(main.lines, hashes, lines)) { out.scenes[scene.id] = main; continue; }
    if (t.unit !== "scene" || audioHash(have) !== audioHash(timingHashes(scene, mainConfig, mainLex, mainVoice)) || audioHash(hashes) !== audioHash(have)) return null;
    const spans = respan(main.lines, lines);
    if (!spans) return null;
    out.scenes[scene.id] = { ...main, lines: lines.map((l, i) => ({ text: l.text, speak: l.speak, hash: hashes[i], start: spans[i][0], end: spans[i][1] })) };
  }
  return out;
}

// Timings that match the script line for line under this config (what the timings gate checks).
export function timingsFresh(script, timings, config) {
  const t = timingVoice(config, timings?.voice);
  const lexicon = { ...(config.lexicon ?? {}), ...(script.lexicon ?? {}) };
  return Boolean(t) && script.scenes.every((s) => timingLinesMatch(timings?.scenes?.[s.id]?.lines ?? [],
    timingHashes(s, config, lexicon, t), sceneSpeech(s, config, lexicon).lines));
}

// A variant project's (timeline/aspect.mjs withAspect) caption timings, kept fresh: placed on the
// cached scene audio's own pauses when it is on disk, else derived from the main timings, and only
// when neither works synthesized (which needs the key).
export async function ensureVariantTimings(project) {
  if (!project.aspect || !existsSync(project.paths.script)) return null;
  const script = readJson(project.paths.script);
  const have = existsSync(project.paths.timings) ? readJson(project.paths.timings) : null;
  const fresh = Boolean(have) && timingsFresh(script, have, project.config);
  if (fresh && !have.derivedFrom && !have.voice?.fallbackFor) return have;
  const to = relative(project.root, project.paths.timings);
  // Derived timings are replaced by measured ones once the voice audio is cached.
  const cached = await runTts(project, script, { cachedOnly: true });
  if (cached) { log(`caption timings for ${project.aspect} → ${to}`); writeJson(project.paths.timings, cached); return cached; }
  if (fresh && !have.voice?.fallbackFor) return have;
  const main = project.main && existsSync(project.main.timings) ? readJson(project.main.timings) : null;
  const mainFresh = main && timingsFresh(script, main, project.main.config);
  if (fresh && (!mainFresh || main.voice?.fallbackFor)) return have;
  const derived = mainFresh ? variantTimings(script, main, project.main.config, project.config) : null;
  if (derived) { log(`caption timings for ${project.aspect} from ${relative(project.root, project.main.timings)} (voice audio not cached) → ${to}`); writeJson(project.paths.timings, derived); return derived; }
  log(`caption timings for ${project.aspect} → ${to}`);
  const made = await runTts(project, script);
  writeJson(project.paths.timings, made);
  return made;
}
