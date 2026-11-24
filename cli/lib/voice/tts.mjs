// Narration TTS. Default unit "scene": one call per scene so the voice keeps natural prosody
// across sentences; caption lines are then placed on the pauses found in that audio.
// Unit "line" synthesizes every caption line separately (exact timing, choppier delivery).
// A designed or cloned voice (`tts.design` / `tts.ref`): every scene is spoken by the voiceclone
// model in the voice of one reference clip — a clip the voicedesign model makes once from a
// description of the speaker (cached by that description), or a recording of the project's own.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireApiKey, pool } from "../core/http.mjs";
import { readWav, toMono, trimSilence, shortenPauses, concatWithGaps, findPauses, timeStretch, writeWav } from "../audio/wav.mjs";
import { speakable, spokenLength } from "../core/text.mjs";
import { sceneLines } from "../captions/lines.mjs";
import { log, warn, UserError } from "../core/project.mjs";
import { integratedLoudness, normalizeLoudness } from "../audio/loudness.mjs";
import { synthesize, TtsUnavailable } from "./providers.mjs";

export { chatRequest } from "./providers.mjs";

export const TTS_DEFAULTS = {
  baseUrl: "https://api.mangoqwq.com/v1",
  model: "mimo-v2.5-tts",
  voice: "mimo_default",
  protocol: "chat",
  unit: "scene",
  keyEnv: "MANGO_API_KEY",
  sampleRate: 24000,
  concurrency: 3,
  pause: { sentence: 0.32, clause: 0.16 },
  leadIn: 0.15,
  tail: 0.35,
  // Narration is normalized as a whole (one gain for every scene) to this integrated loudness.
  loudness: -16,
  designModel: "mimo-v2.5-tts-voicedesign",
  cloneModel: "mimo-v2.5-tts-voiceclone",
  // What the designed speaker reads for the reference clip: varied tones, natural pauses.
  designText: "那天晚上，风一阵比一阵紧。我站在窗边，看着远处那点灯光，忽明忽暗的……说实话，我心里也没底。可是天总会亮的，对吧？",
};

// Pace applied after synthesis (pitch kept): a designed or cloned voice takes its pace from the
// speaker it imitates, and a style hint barely moves it. `tempo: "auto"` measures every scene and,
// when one falls outside the rate band, speeds the narration up (or slows it down) by one factor
// for the whole film, within these limits; a number applies that factor as is.
export const TEMPO_RANGE = [0.8, 1.5];
const AUTO_TEMPO = [0.85, 1.35];
const BAND = [3.5, 6.2]; // the rate gate's default syllablesPerSec

// The tempo marks the timing hashes (so changing it re-times the captions) but not the cached
// synthesis, which stays the voice's own pace.
const tempoTag = (t) => (t.tempo === undefined || t.tempo === 1 ? "" : t.tempo === "auto" ? "~tauto" : `~t${Math.round(t.tempo * 100)}`);

// The single factor "auto" applies, from each scene's syllables/s: lifts the slowest scene just
// inside the band floor without pushing the fastest past the ceiling (or, when one is crowded and
// none slow, the reverse); a narration already inside is left alone.
export function autoTempo(rates, [lo, hi] = BAND) {
  const r = (Array.isArray(rates) ? rates : [rates]).filter((x) => x > 0);
  if (!r.length) return 1;
  const slowest = Math.min(...r), fastest = Math.max(...r);
  let f = 1;
  if (slowest < lo) f = Math.max(1, Math.min((lo * 1.04) / slowest, (hi * 0.97) / fastest));
  else if (fastest > hi) f = Math.min(1, Math.max((hi * 0.96) / fastest, (lo * 1.03) / slowest));
  return Math.round(Math.min(AUTO_TEMPO[1], Math.max(AUTO_TEMPO[0], f)) * 100) / 100;
}

const sha = (...parts) => createHash("sha1").update(parts.join("\u0001")).digest("hex").slice(0, 12);

export function ttsConfig(config) {
  const t = { ...TTS_DEFAULTS, ...(config.tts ?? {}) };
  t.pause = { ...TTS_DEFAULTS.pause, ...(config.tts?.pause ?? {}) };
  if (t.fallbackVoice !== undefined && (!(t.design || t.ref) || typeof t.fallbackVoice !== "string" || !t.fallbackVoice.trim())) {
    throw new UserError("tts.fallbackVoice: set a nonempty stock voice name with tts.design or tts.ref");
  }
  if (t.tempo !== undefined && t.tempo !== "auto" && !(typeof t.tempo === "number" && t.tempo >= TEMPO_RANGE[0] && t.tempo <= TEMPO_RANGE[1])) {
    throw new UserError(`tts.tempo: "auto" or a factor ${TEMPO_RANGE.join("–")} (1.15 = 15% faster), not ${JSON.stringify(t.tempo)}`);
  }
  // A cloned voice: the clone model speaks, and the voice is named by its reference so changing
  // the description (or pointing at another recording) re-synthesizes every scene.
  if (t.design || t.ref) {
    if (t.design && t.ref) throw new UserError("tts: set either design (a described voice) or ref (a recording), not both");
    if (t.protocol !== "chat") throw new UserError("tts: a designed or cloned voice needs protocol chat");
    t.model = config.tts?.model ?? t.cloneModel;
    t.voiceTag = t.design ? `design:${sha(t.designModel, t.design, t.designText)}` : `ref:${t.ref}`;
    t.voice = t.voiceTag;
  }
  return t;
}

export function lineHash(speak, t) {
  return createHash("sha1").update([t.model, t.voice, t.protocol, t.style ?? "", t.instructions ?? "", t.speed ?? "", speak].join("\u0001")).digest("hex").slice(0, 16);
}

// What one scene asks the TTS for. Lines derived from the narration speak the narration itself,
// so its own punctuation (？！) shapes the delivery; explicit lines are joined with their pauses.
export function sceneSpeech(scene, config, lexicon) {
  const lines = sceneLines(scene, config).map((l) => ({ ...l, speak: l.speak ?? speakable(l.text, lexicon) }));
  if (!lines.length) return { lines, speak: "" };
  const speak = Array.isArray(scene.lines)
    ? lines.map((l) => l.speak.replace(/[，。！？,.!?；;、]$/, "") + (l.pause === "clause" ? "，" : "。")).join("")
    : speakable(scene.narration.replace(/\s*\n\s*/g, ""), lexicon);
  return { lines, speak };
}

// Hash per caption line, as stored in timings. Scene unit: every line of a scene carries the
// scene audio hash plus its index. Compare the line text as well when checking freshness.
export function timingHashes(scene, config, lexicon) {
  const t = ttsConfig(config);
  const { lines, speak } = sceneSpeech(scene, config, lexicon);
  const tag = tempoTag(t) + (t.fallbackVoice ? `~f${sha(t.fallbackVoice)}` : "");
  if (t.unit === "line") return lines.map((l) => lineHash(l.speak, t) + tag);
  const h = lineHash(speak, t) + tag;
  return lines.map((_, i) => `${h}.${i}`);
}

export function timingLinesMatch(have, hashes, lines) {
  return have.length === hashes.length && have.every((l, i) => l.hash === hashes[i] && l.text === lines[i].text);
}

// Where the designed voice's reference clip is cached (per description).
export const designFile = (t, linesDir) => join(linesDir, `voice-${t.voiceTag.replace(/^design:/, "")}.wav`);

// The reference clip as the clone model takes it (a data URL), making it first for a design.
export async function voiceRef(t, { root, linesDir }, key) {
  let file;
  if (t.ref) {
    file = join(root, t.ref);
    if (!existsSync(file)) throw new UserError(`tts.ref: no file ${t.ref} (a WAV recording of the voice, 5–30 s, in the project)`);
  } else {
    file = designFile(t, linesDir);
    if (!existsSync(file)) {
      log(`  designing the voice: ${t.design}`);
      const wav = await synthesize(t.designText, { ...t, model: t.designModel, style: t.design, instructions: undefined, refData: undefined, design: true }, key);
      mkdirSync(linesDir, { recursive: true });
      writeFileSync(file, wav);
    }
  }
  const wav = readFileSync(file);
  if (wav.subarray(0, 4).toString() !== "RIFF") throw new UserError(`voice reference ${file} is not a WAV file`);
  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

// Place n caption lines on one scene clip. Each line boundary is estimated from the share of
// syllables before it, then snapped to a detected pause (dynamic programming keeps boundaries in
// time order, so spans never overlap and each pause is used once); a boundary with no pause nearby
// stays at its estimate.
export function alignLines(weights, duration, pauses, kinds = []) {
  const n = weights.length;
  if (n === 1) return [[0, duration]];
  const total = weights.reduce((a, b) => a + b, 0) || n;
  const inner = pauses.filter(([a, b]) => a > 0.05 && b < duration - 0.05);
  const est = [];
  let acc = 0;
  for (let k = 0; k < n - 1; k++) { acc += weights[k]; est.push((duration * acc) / total); }
  const window = Math.max(0.8, (duration / n) * 0.6);
  const miss = window; // cost of leaving a boundary unsnapped
  const m = inner.length;
  // dp[k][j]: best cost for boundaries 0..k with boundary k using pause j-1 (j = 0: unsnapped).
  // A boundary may only start at or after the previous one ends; leaving every boundary at its
  // (non-decreasing) estimate always satisfies that.
  const INF = Infinity;
  const dp = Array.from({ length: n - 1 }, () => new Array(m + 1).fill(INF));
  const from = Array.from({ length: n - 1 }, () => new Array(m + 1).fill(-1));
  const cutStart = (k, j) => (j > 0 ? inner[j - 1][0] : est[k]);
  const cutEnd = (k, j) => (j > 0 ? inner[j - 1][1] : est[k]);
  const cost = (k, j) => {
    if (j === 0) return miss;
    const [a, b] = inner[j - 1];
    const d = Math.abs((a + b) / 2 - est[k]);
    // Longer pauses are likelier breaks, the more so after a full sentence.
    return d > window ? INF : d - Math.min(0.5, b - a) * (kinds[k] === "sentence" ? 1.5 : 0.8);
  };
  for (let j = 0; j <= m; j++) dp[0][j] = cost(0, j);
  for (let k = 1; k < n - 1; k++) {
    for (let j = 0; j <= m; j++) {
      const c = cost(k, j);
      if (c === INF) continue;
      for (let p = 0; p <= m; p++) {
        if (dp[k - 1][p] === INF || cutStart(k, j) < cutEnd(k - 1, p) || (j > 0 && j === p)) continue;
        const v = dp[k - 1][p] + c;
        if (v < dp[k][j]) { dp[k][j] = v; from[k][j] = p; }
      }
    }
  }
  let j = 0;
  for (let q = 1; q <= m; q++) if (dp[n - 2][q] < dp[n - 2][j]) j = q;
  const pick = new Array(n - 1);
  for (let k = n - 2; k >= 0; k--) { pick[k] = j; j = from[k][j]; }
  const cuts = pick.map((p, k) => (p > 0 ? inner[p - 1] : [est[k], est[k]]));
  const spans = [];
  let start = 0;
  for (let k = 0; k < n; k++) {
    const end = k < n - 1 ? cuts[k][0] : duration;
    spans.push([start, Math.max(start, end)]);
    if (k < n - 1) start = Math.max(end, cuts[k][1]);
  }
  return spans;
}

// Build plan/timings.json from the script. Audio is cached by content hash, so editing one
// scene (or one line, in line unit) re-synthesizes only that part. `cachedOnly` returns null
// instead of synthesizing when some unit is not cached yet (no key needed).
export async function runTts(project, script, options = {}) {
  const t = ttsConfig(project.config);
  try {
    return await synthesizeNarration(project, script, t, options);
  } catch (error) {
    if (!(error instanceof TtsUnavailable)) throw error;
    if (!t.voiceTag) throw new UserError(`${error.message}; retry later or choose another TTS model`);
    if (!t.fallbackVoice) throw new UserError(`${error.message}; retry later or explicitly set tts.fallbackVoice to use a stock voice`);
    if (options.only?.length) throw new UserError(`${error.message}; rerun without --only to use tts.fallbackVoice for all narration`);
    const fallback = { ...t, model: TTS_DEFAULTS.model, voice: t.fallbackVoice, voiceTag: undefined, refData: undefined };
    warn(`${error.message}; using stock voice "${fallback.voice}" (${fallback.model}) for all narration, not the requested clone`);
    try {
      return await synthesizeNarration(project, script, fallback, { ...options, force: false },
        { model: t.model, voice: t.voice, unavailableModel: error.model });
    } catch (fallbackError) {
      if (!(fallbackError instanceof TtsUnavailable)) throw fallbackError;
      throw new UserError(`${fallbackError.message}; both the requested clone and its configured stock fallback are unavailable`);
    }
  }
}

async function synthesizeNarration(project, script, t, { force = false, only = [], dry = false, cachedOnly = false }, fallbackFor) {
  const { config, paths } = project;
  const lexicon = { ...(config.lexicon ?? {}), ...(script.lexicon ?? {}) };
  const jobs = [];
  const scenes = script.scenes.map((scene) => {
    const { lines, speak } = sceneSpeech(scene, config, lexicon);
    const hashes = timingHashes(scene, config, lexicon);
    const lineJobs = lines.map((l, i) => ({ scene: scene.id, text: l.text, speak: l.speak, hash: hashes[i], pause: l.pause }));
    // One synthesis unit per scene, or per line.
    const units = !lines.length ? [] : t.unit === "line"
      ? lineJobs.map((l) => ({ scene: scene.id, label: l.text, speak: l.speak, file: join(paths.linesDir, `${lineHash(l.speak, t)}.wav`) }))
      : [{ scene: scene.id, label: `${lines.length} line(s), ${spokenLength(speak)} syllables`, speak, file: join(paths.linesDir, `${lineHash(speak, t)}.wav`) }];
    // --only limits synthesis to those scenes; the others must already be cached.
    const selected = only.length === 0 || only.includes(scene.id);
    for (const u of units) if (selected && (force || !existsSync(u.file))) jobs.push(u);
    return { id: scene.id, lines: lineJobs, units };
  });

  if (dry) {
    for (const s of scenes) {
      for (const l of s.lines) log(`${s.id}\t${l.pause}\t${l.text}${l.speak !== l.text ? `\t→ ${l.speak}` : ""}`);
      if (t.unit !== "line" && s.units.length) log(`${s.id}\tspeak\t${s.units[0].speak}`);
    }
    log(`${jobs.length} ${t.unit}(s) would be synthesized (voice ${t.voice}, ${t.protocol})`);
    return null;
  }

  if (cachedOnly && jobs.length) return null;
  if (jobs.length) {
    const key = requireApiKey(t.keyEnv, t.baseUrl);
    mkdirSync(paths.linesDir, { recursive: true });
    if (t.voiceTag) t.refData = await voiceRef(t, { root: project.root, linesDir: paths.linesDir }, key);
    let done = 0;
    await pool(jobs, t.concurrency, async (job) => {
      const buf = await synthesize(job.speak, t, key);
      writeFileSync(job.file, buf);
      done++;
      log(`  [${done}/${jobs.length}] ${job.scene}: ${job.label}`);
    });
  } else log("all audio cached");
  const uncached = scenes.flatMap((s) => s.units).filter((u) => !existsSync(u.file));
  if (uncached.length) throw new UserError(`${uncached.length} ${t.unit}(s) outside --only are not synthesized yet (first: scene "${uncached[0].scene}"); run: onevideo tts`);

  const out = { sampleRate: t.sampleRate, voice: { model: t.model, voice: t.voice, protocol: t.protocol, unit: t.unit,
    ...(t.design && !fallbackFor && { design: t.design }), ...(fallbackFor && { fallbackFor }) }, scenes: {} };
  const prepared = {};
  const maxTempo = t.tempo === "auto" ? AUTO_TEMPO[1] : Math.max(1, t.tempo ?? 1);
  const minSpan = Math.ceil(1000 / (config.fps ?? 30)) / 1000 * maxTempo;
  for (const s of scenes) if (s.lines.length) {
    const raw = s.units.map((u) => trimSilence(toMono(readWav(u.file), t.sampleRate), t.sampleRate));
    if (t.unit === "line") {
      prepared[s.id] = { clips: raw.map((clip) => shortenPauses(clip, t.sampleRate).samples) };
    } else {
      const spans = sceneLineSpans(s, raw[0], t.sampleRate);
      const { samples, timeAt } = shortenPauses(raw[0], t.sampleRate, { preserve: spans, minSpan });
      prepared[s.id] = { clips: [samples], spans: spans.map(([a, b]) => [timeAt(a), timeAt(b)]) };
    }
  }
  const tempo = t.tempo === "auto" ? autoTempo(sceneRates(scenes, prepared, t.sampleRate), config.gates?.syllablesPerSec) : t.tempo ?? 1;
  if (tempo !== 1) {
    log(`  tempo ×${tempo}${t.tempo === "auto" ? " (auto: the voice's own pace is outside the rate band)" : ""}`);
    out.voice.tempo = tempo;
  }
  const joinedById = {};
  const spansById = {};
  for (const s of scenes) {
    if (!s.lines.length) continue;
    const lead = new Float32Array(Math.round(t.leadIn * t.sampleRate));
    const { clips, spans } = prepared[s.id];
    const paced = tempo === 1 ? clips : clips.map((clip) => timeStretch(clip, t.sampleRate, tempo));
    if (t.unit === "line") {
      const gaps = s.lines.map((l, i) => (i === s.lines.length - 1 ? t.tail : t.pause[l.pause] ?? t.pause.sentence));
      const joined = concatWithGaps([lead, ...paced], [0, ...gaps], t.sampleRate);
      joinedById[s.id] = joined;
      spansById[s.id] = joined.spans.slice(1);
    } else {
      const scale = clips[0].length ? paced[0].length / clips[0].length : 1;
      joinedById[s.id] = concatWithGaps([lead, paced[0]], [0, t.tail], t.sampleRate);
      spansById[s.id] = spans.map(([a, b]) => [t.leadIn + a * scale, t.leadIn + b * scale]);
    }
  }
  // One shared gain keeps the voice level consistent between scenes.
  const parts = Object.values(joinedById).map((j) => j.samples);
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((o, p) => (all.set(p, o), o + p.length), 0);
  const measured = integratedLoudness(all, t.sampleRate, { fullScale: 32768 });
  const target = t.loudness === false ? measured : t.loudness;
  let total = 0;
  for (const s of scenes) {
    if (!s.lines.length) {
      out.scenes[s.id] = { file: null, duration: 0, lines: [] };
      continue;
    }
    const joined = joinedById[s.id];
    const samples = Number.isFinite(measured) ? normalizeLoudness(joined.samples, t.sampleRate, { target, measuredOverride: measured, fullScale: 32768 }).samples : joined.samples;
    const rel = `${paths.audioRel ?? "audio"}/${s.id}.wav`;
    writeWav(join(paths.audioDir, `${s.id}.wav`), { samples, sampleRate: t.sampleRate, channels: 1 });
    out.scenes[s.id] = {
      file: rel,
      duration: round(joined.duration),
      lines: s.lines.map((l, i) => ({ text: l.text, speak: l.speak, hash: l.hash, start: round(spansById[s.id][i][0]), end: round(spansById[s.id][i][1]) })),
    };
    total += joined.duration;
  }
  if (Number.isFinite(measured)) out.loudness = { measured: round(measured), target, gainDb: round(target - measured) };
  out.totalNarration = round(total);
  return out;
}

const round = (x) => Math.round(x * 1000) / 1000;

function sceneLineSpans(scene, clip, sampleRate) {
  return alignLines(scene.lines.map((l) => Math.max(1, spokenLength(l.speak))), clip.length / sampleRate,
    findPauses(clip, sampleRate), scene.lines.map((l) => l.pause));
}

// Each scene's syllables per second as the rate gate counts them (caption text over the speech
// each line spans): line unit times each clip, scene unit places the lines on the scene's pauses.
function sceneRates(scenes, prepared, sampleRate) {
  const rates = [];
  for (const s of scenes) {
    if (!s.lines.length) continue;
    const { clips, spans } = prepared[s.id];
    const chars = s.lines.reduce((n, l) => n + spokenLength(l.text), 0);
    const speech = spans ? spans.reduce((n, [a, b]) => n + (b - a), 0) : clips.reduce((n, c) => n + c.length / sampleRate, 0);
    if (speech > 0) rates.push(chars / speech);
  }
  return rates;
}
