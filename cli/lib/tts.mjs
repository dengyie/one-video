// Narration TTS. Default unit "scene": one call per scene so the voice keeps natural prosody
// across sentences; caption lines are then placed on the pauses found in that audio.
// Unit "line" synthesizes every caption line separately (exact timing, choppier delivery).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request, requireApiKey, pool } from "./http.mjs";
import { parseWav, readWav, toMono, trimSilence, concatWithGaps, findPauses, writeWav } from "./wav.mjs";
import { splitLines, speakable, spokenLength } from "./text.mjs";
import { log, UserError } from "./project.mjs";
import { integratedLoudness, normalizeLoudness } from "./loudness.mjs";

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
};

export function ttsConfig(config) {
  const t = { ...TTS_DEFAULTS, ...(config.tts ?? {}) };
  t.pause = { ...TTS_DEFAULTS.pause, ...(config.tts?.pause ?? {}) };
  return t;
}

export function captionMaxChars(config) {
  return config.captions?.maxChars ?? (config.aspect === "9:16" ? 13 : 22);
}

// Resolve a scene's narration into caption/TTS lines.
export function sceneLines(scene, config) {
  if (Array.isArray(scene.lines)) return scene.lines.map((l) => (typeof l === "string" ? { text: l, pause: "sentence" } : { pause: "sentence", ...l }));
  if (!scene.narration) return [];
  return splitLines(scene.narration, captionMaxChars(config));
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
// scene audio hash plus its index, so a voice, style, text or line-split change all invalidate.
export function timingHashes(scene, config, lexicon) {
  const t = ttsConfig(config);
  const { lines, speak } = sceneSpeech(scene, config, lexicon);
  if (t.unit === "line") return lines.map((l) => lineHash(l.speak, t));
  const h = lineHash(speak, t);
  return lines.map((_, i) => `${h}.${i}`);
}

async function synthesize(speak, t, key) {
  const base = t.baseUrl.replace(/\/$/, "");
  let wav;
  if (t.protocol === "chat") {
    const messages = [{ role: "assistant", content: speak }];
    if (t.style ?? t.instructions) messages.unshift({ role: "user", content: t.style ?? t.instructions });
    const json = { model: t.model, messages, audio: { format: "wav", voice: t.voice }, stream: false };
    const res = await request(`${base}/chat/completions`, { method: "POST", json, key, timeoutSec: 240, retries: 3 });
    let data;
    try { data = JSON.parse(res.body.toString()).choices?.[0]?.message?.audio?.data; } catch { /* reported below */ }
    if (!data) throw new Error(`TTS chat response has no audio: ${res.body.subarray(0, 200).toString()}`);
    wav = Buffer.from(data, "base64");
  } else {
    const json = { model: t.model, input: speak, voice: t.voice, response_format: "wav" };
    if (t.speed) json.speed = t.speed;
    if (t.instructions ?? t.style) json.instructions = t.instructions ?? t.style;
    wav = (await request(`${base}/audio/speech`, { method: "POST", json, key, timeoutSec: 240, retries: 3 })).body;
  }
  if (wav.subarray(0, 4).toString() !== "RIFF") throw new Error(`TTS returned non-WAV data: ${wav.subarray(0, 200).toString()}`);
  parseWav(wav); // fail fast on a truncated file
  return wav;
}

// Place n caption lines on one scene clip. Each line boundary is estimated from the share of
// syllables before it, then snapped to a detected pause (dynamic programming keeps pauses in
// order and each used once); a boundary with no pause nearby stays at its estimate.
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
  // dp[k][j]: best cost for boundaries 0..k with boundary k using pause j-1 (j = 0: unsnapped), last pause index used.
  const INF = Infinity;
  const dp = Array.from({ length: n - 1 }, () => new Array(m + 1).fill(INF));
  const from = Array.from({ length: n - 1 }, () => new Array(m + 1).fill(-1));
  const lastUsed = Array.from({ length: n - 1 }, () => new Array(m + 1).fill(-1));
  const cost = (k, j) => {
    if (j === 0) return miss;
    const [a, b] = inner[j - 1];
    const d = Math.abs((a + b) / 2 - est[k]);
    // Longer pauses are likelier breaks, the more so after a full sentence.
    return d > window ? INF : d - Math.min(0.5, b - a) * (kinds[k] === "sentence" ? 1.5 : 0.8);
  };
  for (let j = 0; j <= m; j++) { dp[0][j] = cost(0, j); lastUsed[0][j] = j - 1; }
  for (let k = 1; k < n - 1; k++) {
    for (let j = 0; j <= m; j++) {
      const c = cost(k, j);
      if (c === INF) continue;
      for (let p = 0; p <= m; p++) {
        if (dp[k - 1][p] === INF) continue;
        const used = lastUsed[k - 1][p];
        if (j > 0 && j - 1 <= used) continue;
        const v = dp[k - 1][p] + c;
        if (v < dp[k][j]) { dp[k][j] = v; from[k][j] = p; lastUsed[k][j] = j > 0 ? j - 1 : used; }
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
// scene (or one line, in line unit) re-synthesizes only that part.
export async function runTts(project, script, { force = false, only = [], dry = false } = {}) {
  const { config, paths } = project;
  const t = ttsConfig(config);
  const lexicon = { ...(config.lexicon ?? {}), ...(script.lexicon ?? {}) };
  const jobs = [];
  const scenes = script.scenes.map((scene) => {
    const { lines, speak } = sceneSpeech(scene, config, lexicon);
    const hashes = timingHashes(scene, config, lexicon);
    const lineJobs = lines.map((l, i) => ({ scene: scene.id, text: l.text, speak: l.speak, hash: hashes[i], pause: l.pause }));
    // One synthesis unit per scene, or per line.
    const units = !lines.length ? [] : t.unit === "line"
      ? lineJobs.map((l) => ({ scene: scene.id, label: l.text, speak: l.speak, file: join(paths.linesDir, `${l.hash}.wav`) }))
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

  if (jobs.length) {
    const key = requireApiKey(t.keyEnv, t.baseUrl);
    mkdirSync(paths.linesDir, { recursive: true });
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

  const out = { sampleRate: t.sampleRate, voice: { model: t.model, voice: t.voice, protocol: t.protocol, unit: t.unit }, scenes: {} };
  const joinedById = {};
  const spansById = {};
  for (const s of scenes) {
    if (!s.lines.length) continue;
    const lead = new Float32Array(Math.round(t.leadIn * t.sampleRate));
    const clips = s.units.map((u) => trimSilence(toMono(readWav(u.file), t.sampleRate), t.sampleRate));
    if (t.unit === "line") {
      const gaps = s.lines.map((l, i) => (i === s.lines.length - 1 ? t.tail : t.pause[l.pause] ?? t.pause.sentence));
      const joined = concatWithGaps([lead, ...clips], [0, ...gaps], t.sampleRate);
      joinedById[s.id] = joined;
      spansById[s.id] = joined.spans.slice(1);
    } else {
      const clip = clips[0];
      const dur = clip.length / t.sampleRate;
      const spans = alignLines(s.lines.map((l) => Math.max(1, spokenLength(l.speak))), dur, findPauses(clip, t.sampleRate), s.lines.map((l) => l.pause));
      joinedById[s.id] = concatWithGaps([lead, clip], [0, t.tail], t.sampleRate);
      spansById[s.id] = spans.map(([a, b]) => [t.leadIn + a, t.leadIn + b]);
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
