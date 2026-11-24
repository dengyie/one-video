// Plan gates, run on the written plan before anything is compiled: schema, sourced numbers,
// storyboard ids and cues, timings freshness, speech rate, asset licensing and the length budget.
import { loadSchema, validate } from "../core/schema.mjs";
import { normalizeLicense } from "../core/license.mjs";
import { extractNumbers, parseNumber, spokenLength } from "../core/text.mjs";
import { timingHashes, timingLinesMatch, timingVoice } from "../voice/tts.mjs";
import { sceneLines } from "../captions/lines.mjs";
import { named, sameWorld } from "../timeline/index.mjs";
import { GATE_DEFAULTS, STATIC_TYPES, issue } from "./issue.mjs";

const DEFAULT_HOLD_EST = 0.5;

// Media a plan points at: every `asset`, `avatar` or `logo` id anywhere under v (scene props,
// backdrops, overlays, device screens, split sides), with the path it was found at.
export function assetPaths(v, path = "", out = []) {
  if (Array.isArray(v)) v.forEach((x, i) => assetPaths(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if ((k === "asset" || k === "avatar" || k === "logo") && typeof x === "string") out.push({ id: x, path: path ? `${path}.${k}` : k });
      else assetPaths(x, path ? `${path}.${k}` : k, out);
    }
  }
  return out;
}
export const assetRefs = (v) => new Set(assetPaths(v).map((r) => r.id));

// A drawn project (config.drawn, pipeline graphics): every frame comes from code. Photos, footage,
// screen captures and generated media are errors wherever the storyboard names them; Lucide icons,
// flags, Lottie animations from the local library, maps and procedural sound stay allowed.
export function drawnGate(storyboard, assets, config) {
  if (!config.drawn) return [];
  const out = [];
  for (const sc of storyboard.scenes ?? []) {
    const refs = assetPaths(sc);
    if (refs.length) out.push(issue("error", "drawn", `scene "${sc.id}" uses media in a drawn project: ${refs.map((r) => `${r.path} "${r.id}"`).join(", ")} — draw it instead (kinetic, canvas, tableau, charts, unit-grid, scale-compare, map, icons) or switch the pipeline`));
    if (sc.background === "media") out.push(issue("error", "drawn", `scene "${sc.id}" has background "media" in a drawn project — use aurora, particles, waves, grid or stars`));
  }
  if (assets?.items?.length) out.push(issue("warn", "drawn", `plan/assets.json lists ${assets.items.length} item(s) a drawn project never shows; remove it`));
  return out;
}

export function schemaGate(name, value) {
  const schema = loadSchema(name);
  const errors = validate(schema, value);
  // Storyboard props are checked per scene type against schema.props[type].
  if (name === "storyboard" && !errors.length) {
    value.scenes.forEach((sc, i) => validate(schema.props[sc.type], sc.props ?? {}, schema, `$.scenes[${i}](${sc.id}).props`, errors));
  }
  return errors.map((m) => issue("error", `schema:${name}`, m));
}

// Every number spoken in narration must equal a number in a research fact (claim, value or quote),
// token for token: "25万亿" is not sourced by a "2025年" fact, and "1.8万亿" is not "1.85万亿".
// Units must agree when both sides carry one; a numeric fact value also matches by magnitude ("857亿" = 85.7e9).
// A story (config.fiction) without research has no claims to check; with one, it is held like any.
export function numbersGate(script, research, config = {}) {
  if (!research) return config.fiction === true ? [] : [issue("warn", "facts", "no plan/research.json; narration numbers are unchecked (a made-up story: \"fiction\": true in onevideo.json)")];
  const sourced = [];
  const amounts = [];
  for (const f of research.facts ?? []) {
    for (const t of [f.claim, f.quote, typeof f.value === "string" ? f.value : null].filter(Boolean).flatMap(extractNumbers)) sourced.push(parseNumber(t));
    if (typeof f.value === "number") { sourced.push({ value: f.value, unit: "" }); amounts.push(f.value); }
  }
  const same = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const isSourced = (n) =>
    sourced.some((c) => same(c.value, n.value) && (!c.unit || !n.unit || c.unit === n.unit)) ||
    (n.amount !== n.value && amounts.some((a) => same(a, n.amount)));
  const allowed = new Set((research.allowNumbers ?? []).map((a) => String(a).replace(/[\s,]/g, "")));
  const out = [];
  for (const s of script.scenes) {
    // The text actually spoken: explicit lines win over narration, as in sceneLines.
    const text = Array.isArray(s.lines) ? s.lines.map((l) => (typeof l === "string" ? l : l.text)).join("") : s.narration ?? "";
    for (const tok of extractNumbers(text)) {
      const n = parseNumber(tok);
      const plain = tok.replace(/,/g, "");
      if (allowed.has(plain) || allowed.has(String(n.value))) continue;
      if (!n.unit && Number.isInteger(n.value) && n.value < 10 && !/[.,]/.test(tok)) continue; // bare single digits ("3 个原因") are structure, not claims
      if (!isSourced(n)) out.push(issue("error", "facts", `scene "${s.id}": number "${tok}" not found in research facts (add a sourced fact or list it in research.allowNumbers)`));
    }
  }
  for (const f of research.facts ?? []) if (!f.source?.url && !f.source?.title) out.push(issue("error", "facts", `fact "${f.id}" has no source`));
  // script claims are the audit trail from a scene back to its facts; dangling ids break it.
  const ids = new Set((research.facts ?? []).map((f) => f.id));
  for (const s of script.scenes) for (const c of s.claims ?? []) if (!ids.has(c)) out.push(issue("error", "facts", `scene "${s.id}": claim "${c}" is not a fact id in research.json`));
  return out;
}

export function storyboardGate(storyboard, script, config, assets) {
  const g = { ...GATE_DEFAULTS, ...(config.gates ?? {}) };
  const out = [];
  const ids = script.scenes.map((s) => s.id);
  const sbIds = storyboard.scenes.map((s) => s.id);
  const dup = sbIds.filter((id, i) => sbIds.indexOf(id) !== i);
  if (dup.length) out.push(issue("error", "ids", `duplicate storyboard ids: ${[...new Set(dup)].join(", ")}`));
  for (const id of ids) if (!sbIds.includes(id)) out.push(issue("error", "ids", `script scene "${id}" missing from storyboard`));
  for (const id of sbIds) if (!ids.includes(id)) out.push(issue("error", "ids", `storyboard scene "${id}" missing from script`));
  if (sbIds.join() !== ids.filter((id) => sbIds.includes(id)).join()) out.push(issue("warn", "ids", "storyboard order differs from script order; storyboard order wins"));

  const types = storyboard.scenes.map((s) => s.type);
  const staticCount = types.filter((t) => STATIC_TYPES.has(t)).length;
  const ratio = staticCount / Math.max(1, types.length);
  if (ratio > g.staticRatioMax) out.push(issue("error", "slideshow", `${Math.round(ratio * 100)}% of scenes are static text (${[...STATIC_TYPES].join("/")}); max ${Math.round(g.staticRatioMax * 100)}% — convert some to charts, media or timelines`));
  let run = 1;
  for (let i = 1; i < types.length; i++) {
    // One device staying on screen across scenes is the point of a product demo, not a repeat; one
    // world continued (inherit) is one story told in several shots, each of which moves on.
    const [prev, next] = [storyboard.scenes[i - 1], storyboard.scenes[i]];
    run = types[i] === types[i - 1] && types[i] !== "device" && !sameWorld(prev, next) ? run + 1 : 1;
    if (run === g.maxSameTypeRun + 1) out.push(issue("warn", "variety", `${run}+ consecutive "${types[i]}" scenes ending at "${sbIds[i]}"`));
  }

  const assetIds = new Set((assets?.items ?? []).map((a) => a.id));
  for (const sb of storyboard.scenes) {
    const sc = script.scenes.find((s) => s.id === sb.id);
    if (!sc) continue;
    const chars = sceneLines(sc, config).reduce((n, l) => n + spokenLength(l.text), 0);
    const estimate = chars / (config.tts?.syllablesPerSecond ?? SYLLABLES_PER_SEC);
    if (estimate > g.longSceneNoCue && Object.keys(sb.cues ?? {}).length === 0) out.push(issue("warn", "pacing", `scene "${sb.id}" ≈${estimate.toFixed(0)}s of narration with no cues — add reveals so the screen changes with the voice`));
    for (const ref of cueRefs(sb.props)) if (!(ref in (sb.cues ?? {}))) out.push(issue("error", "cues", `scene "${sb.id}": props reference cue "${ref}" which is not defined in scene.cues`));
    // A cue nothing names changes nothing on screen (unless something is pinned on its phrase
    // directly); one named after a side or block of the props (compare "left"/"right") was meant for it.
    const said = named({ ...sb, cues: undefined, id: undefined });
    for (const [name] of Object.entries(sb.cues ?? {}).filter(([k, v]) => !said.has(k) && !said.has(v?.phrase ?? v))) {
      const own = sb.props?.[name] && typeof sb.props[name] === "object" && !Array.isArray(sb.props[name]) && !sb.props[name].cue;
      out.push(issue("warn", "cues", `scene "${sb.id}": cue "${name}" is not used by props, overlays, shots or sfx — nothing changes on screen there${own ? ` (set "cue": "${name}" on props.${name})` : ""}`, null, own ? { scene: sb.id, path: ["props", name, "cue"], value: name, add: true } : null));
    }
    if (sb.type === "media" && sb.props?.asset && !assetIds.has(sb.props.asset)) out.push(issue("error", "assets", `scene "${sb.id}" uses unknown asset "${sb.props.asset}"`));
    if (!chars && !sb.duration) out.push(issue("warn", "pacing", `scene "${sb.id}" has no narration and no duration; defaults to 4s`));
  }
  return out;
}

function cueRefs(v, out = []) {
  if (Array.isArray(v)) v.forEach((x) => cueRefs(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if ((k === "cue" || k === "drawCue" || k === "noteCue") && typeof x === "string") out.push(x);
      else if ((k === "periodCues" || k === "pointCues" || k === "itemCues") && Array.isArray(x)) out.push(...x.filter((c) => typeof c === "string"));
      else cueRefs(x, out);
    }
  }
  return out;
}

// timings.json must match the current narration line for line (same text, pronunciation and voice);
// otherwise captions and cues would be timed against audio of a different script.
export function timingsGate(script, timings, config) {
  const lexicon = { ...(config.lexicon ?? {}), ...(script.lexicon ?? {}) };
  const voice = timingVoice(config, timings.voice);
  const out = [];
  for (const s of script.scenes) {
    const want = timingHashes(s, config, lexicon, voice ?? undefined);
    const have = timings.scenes?.[s.id]?.lines ?? [];
    if ((want.length && !voice) || !timingLinesMatch(have, want, sceneLines(s, config))) out.push(issue("error", "timings", `scene "${s.id}" narration, captions or voice changed since tts; run: onevideo tts`));
  }
  return out;
}

// Measured speech rate per scene (needs timings).
export function rateGate(script, timings, config) {
  const g = { ...GATE_DEFAULTS, ...(config.gates ?? {}) };
  const out = [];
  for (const s of script.scenes) {
    const t = timings?.scenes?.[s.id];
    if (!t?.lines?.length) continue;
    const chars = t.lines.reduce((n, l) => n + spokenLength(l.text), 0);
    const speech = t.lines.reduce((n, l) => n + (l.end - l.start), 0);
    const rate = chars / Math.max(0.1, speech);
    if (rate >= g.syllablesPerSec[0] && rate <= g.syllablesPerSec[1]) continue;
    // Name the line furthest out, and the lever: a designed or chat voice takes its pace from the
    // style text (speed only reaches the speech protocol); ellipses and dashes stretch a line.
    const lineRate = (l) => spokenLength(l.text) / Math.max(0.1, l.end - l.start);
    const slow = rate < g.syllablesPerSec[0];
    const worst = t.lines.reduce((a, l) => ((slow ? lineRate(l) < lineRate(a) : lineRate(l) > lineRate(a)) ? l : a));
    const lever = slow
      ? config.tts?.tempo === "auto"
        ? `the voice drags even after tts.tempo "auto" (×${timings.voice?.tempo ?? 1}: capped at ×1.35, or held back so the fastest scene stays under ${g.syllablesPerSec[1]}) — pick a brisker speaker (onevideo tts --audition), tighten the slow line, drop ……/—— that stretch pauses`
        : `the voice drags — set tts.tempo "auto" (speeds the narration into the band, pitch kept) or a factor like 1.2; a designed voice keeps its speaker's pace whatever tts.style says; drop ……/—— that stretch pauses`
      : "too crowded to follow — cut words or split the scene, or ask for a calmer pace in tts.style";
    out.push(issue("warn", "rate", `scene "${s.id}" speaks ${rate.toFixed(1)} syllables/s (expected ${g.syllablesPerSec.join("–")}; "${worst.text}" ${lineRate(worst).toFixed(1)}/s): ${lever}`));
  }
  return out;
}

// `used` (ids the compiled timeline renders), when given, limits the softness warning to assets on
// screen: a low-res candidate left unpicked in the manifest costs nothing.
export function assetsGate(assets, config = {}, used) {
  const out = [];
  const minShort = config.gates?.minImageShortSide ?? 720;
  const seen = new Map();
  for (const a of assets?.items ?? []) {
    if (!a.file) out.push(issue("error", "assets", `asset "${a.id}" not fetched yet; run: onevideo assets fetch`));
    if (!a.license) out.push(issue("error", "licensing", `asset "${a.id}" has no license recorded`));
    else {
      const norm = normalizeLicense(a.license);
      if (!norm) out.push(issue("error", "licensing", `asset "${a.id}" license "${a.license}" is not on the allowlist (PD/CC0, CC BY, CC BY-SA, Pexels, Pixabay, generated, own)`));
      else if (["cc-by", "cc-by-sa"].includes(norm) && (!a.author || !a.source)) out.push(issue("error", "licensing", `asset "${a.id}" (${a.license}) needs author and source for attribution`));
    }
    if (a.width && a.height && Math.min(a.width, a.height) < minShort && (!used || used.has(a.id))) out.push(issue("warn", "assets", `asset "${a.id}" is ${a.width}x${a.height}; short side < ${minShort}px will look soft`));
    if (a.fallback) { out.push(issue("warn", "assets", `asset "${a.id}" is still "${a.fallback.from}" standing in for its generated clip (${a.fallback.reason || "generation failed"}); run onevideo assets fetch --only ${a.id} to try again`)); continue; }
    if (a.clipPick?.fits === false) out.push(issue("warn", "assets", `asset "${a.id}": no frame of its film shows "${a.query ?? "its query"}" (${a.clipPick.model}: ${String(a.clipPick.reason ?? "").slice(0, 120)}); give it another query or a url and fetch again`));
    // Captures of one page in different states (clicked, other device) are different screens; windows
    // cut from one long film are different shots.
    const key = a.capture ? JSON.stringify([a.source, a.capture.device, a.capture.click ?? [], a.capture.full, a.capture.dark]) : a.kind === "video" && a.clip ? JSON.stringify([a.source, a.clip]) : a.source;
    if (key) {
      if (seen.has(key)) out.push(issue("warn", "assets", `assets "${seen.get(key)}" and "${a.id}" are the same source media`));
      else seen.set(key, a.id);
    }
  }
  return out;
}

// Runtime vs. the target length in onevideo.json: the compiled timeline once there is one (the
// voice's real pace, holds, transitions and end card), before that an estimate from the syllables —
// which a slow designed voice can miss by a quarter.
export const SYLLABLES_PER_SEC = 4.8;
export function budgetGate(script, config, timeline = null) {
  if (!config.targetSeconds) return [];
  let est = timeline?.duration;
  if (!(est > 0)) {
    const cps = config.tts?.syllablesPerSecond ?? SYLLABLES_PER_SEC;
    let chars = 0, lines = 0;
    for (const s of script.scenes) for (const l of sceneLines(s, config)) { chars += spokenLength(l.text); lines++; }
    est = chars / cps + lines * 0.3 + script.scenes.length * DEFAULT_HOLD_EST;
  }
  const dev = (est - config.targetSeconds) / config.targetSeconds;
  const msg = `${timeline?.duration > 0 ? "runs" : "estimated"} ${est.toFixed(0)}s vs target ${config.targetSeconds}s (${dev >= 0 ? "+" : ""}${(dev * 100).toFixed(0)}%)`;
  if (Math.abs(dev) > 0.25) return [issue("error", "budget", `${msg}; cut or extend narration`)];
  if (Math.abs(dev) > 0.12) return [issue("warn", "budget", msg)];
  return [];
}
