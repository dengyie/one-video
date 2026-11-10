// Pre-compose gates: catch structural, factual and pacing problems before spending a render.
import { validate, loadSchema } from "./schema.mjs";
import { extractNumbers, parseNumber, visualLength, spokenLength, normalizeForMatch } from "./text.mjs";
import { sceneLines, captionMaxChars, timingHashes } from "./tts.mjs";

export const STATIC_TYPES = new Set(["quote", "bullets", "title", "chapter", "sources"]);
const DEFAULT_HOLD_EST = 0.5;
export const GATE_DEFAULTS = { staticRatioMax: 0.4, maxSameTypeRun: 2, longSceneNoCue: 25, syllablesPerSec: [3.5, 6.2], maxStill: 4.5, maxSameTransitionRun: 2, echoMinChars: 8 };

const issue = (level, gate, msg) => ({ level, gate, msg });

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
export function numbersGate(script, research) {
  if (!research) return [issue("warn", "facts", "no plan/research.json; narration numbers are unchecked")];
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
    const text = s.narration ?? (s.lines ?? []).map((l) => (typeof l === "string" ? l : l.text)).join("");
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

export function captionGate(script, config) {
  const max = captionMaxChars(config);
  const out = [];
  for (const s of script.scenes) {
    for (const l of sceneLines(s, config)) {
      if (visualLength(l.text) > max + 0.5) out.push(issue("warn", "captions", `scene "${s.id}": line "${l.text}" is ${visualLength(l.text).toFixed(1)} wide (max ${max})`));
    }
  }
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
    // One device staying on screen across scenes is the point of a product demo, not a repeat.
    run = types[i] === types[i - 1] && types[i] !== "device" ? run + 1 : 1;
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
    if (sb.type === "media" && sb.props?.asset && !assetIds.has(sb.props.asset)) out.push(issue("error", "assets", `scene "${sb.id}" uses unknown asset "${sb.props.asset}"`));
    if (!chars && !sb.duration) out.push(issue("warn", "pacing", `scene "${sb.id}" has no narration and no duration; defaults to 4s`));
  }
  return out;
}

function cueRefs(v, out = []) {
  if (Array.isArray(v)) v.forEach((x) => cueRefs(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if ((k === "cue" || k === "drawCue") && typeof x === "string") out.push(x);
      else if (k === "periodCues" && Array.isArray(x)) out.push(...x.filter((c) => typeof c === "string"));
      else cueRefs(x, out);
    }
  }
  return out;
}

// timings.json must match the current narration line for line (same text, pronunciation and voice);
// otherwise captions and cues would be timed against audio of a different script.
export function timingsGate(script, timings, config) {
  const lexicon = { ...(config.lexicon ?? {}), ...(script.lexicon ?? {}) };
  const out = [];
  for (const s of script.scenes) {
    const want = timingHashes(s, config, lexicon);
    const have = (timings.scenes?.[s.id]?.lines ?? []).map((l) => l.hash);
    if (!want.length && !have.length) continue;
    if (want.join() !== have.join()) out.push(issue("error", "timings", `scene "${s.id}" narration or voice changed since tts; run: onevideo tts`));
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
    if (rate < g.syllablesPerSec[0] || rate > g.syllablesPerSec[1]) out.push(issue("warn", "rate", `scene "${s.id}" speaks ${rate.toFixed(1)} syllables/s (expected ${g.syllablesPerSec.join("–")})`));
  }
  return out;
}

// Allowlist, not denylist: anything not recognised as reusable blocks the render.
export function normalizeLicense(l) {
  const s = String(l ?? "").trim().toLowerCase().replace(/[-_]/g, " ");
  if (/^(pd|public domain|pdm|cc0|pd \(nasa\))/.test(s) || s.includes("public domain")) return "pd";
  if (s === "generated") return "generated";
  if (s.includes("pexels")) return "pexels";
  if (s.includes("pixabay")) return "pixabay";
  if (/\b(nc|nd)\b|non ?commercial|no ?deriv/.test(s)) return null;
  if (/^cc by sa\b/.test(s)) return "cc-by-sa";
  if (/^cc by\b/.test(s)) return "cc-by";
  if (s === "own" || s === "self") return "own";
  return null;
}

export function assetsGate(assets, config = {}) {
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
    if (a.width && a.height && Math.min(a.width, a.height) < minShort) out.push(issue("warn", "assets", `asset "${a.id}" is ${a.width}x${a.height}; short side < ${minShort}px will look soft`));
    if (a.fallback) { out.push(issue("warn", "assets", `asset "${a.id}" is still "${a.fallback.from}" standing in for its generated clip (${a.fallback.reason || "generation failed"}); run onevideo assets fetch --only ${a.id} to try again`)); continue; }
    // Captures of one page in different states (clicked, other device) are different screens.
    const key = a.capture ? JSON.stringify([a.source, a.capture.device, a.capture.click ?? [], a.capture.full, a.capture.dark]) : a.source;
    if (key) {
      if (seen.has(key)) out.push(issue("warn", "assets", `assets "${seen.get(key)}" and "${a.id}" are the same source media`));
      else seen.set(key, a.id);
    }
  }
  return out;
}

// Estimated runtime from spoken syllables vs. the target length in onevideo.json.
export const SYLLABLES_PER_SEC = 4.8;
export function budgetGate(script, config) {
  if (!config.targetSeconds) return [];
  const cps = config.tts?.syllablesPerSecond ?? SYLLABLES_PER_SEC;
  let chars = 0, lines = 0;
  for (const s of script.scenes) for (const l of sceneLines(s, config)) { chars += spokenLength(l.text); lines++; }
  const est = chars / cps + lines * 0.3 + script.scenes.length * DEFAULT_HOLD_EST;
  const dev = (est - config.targetSeconds) / config.targetSeconds;
  const msg = `estimated ${est.toFixed(0)}s vs target ${config.targetSeconds}s (${dev >= 0 ? "+" : ""}${(dev * 100).toFixed(0)}%)`;
  if (Math.abs(dev) > 0.25) return [issue("error", "budget", `${msg}; cut or extend narration`)];
  if (Math.abs(dev) > 0.12) return [issue("warn", "budget", msg)];
  return [];
}
// Reveal times the compiler resolved into props (`t` of items, morphs, path stops, cards…).
function propTimes(v, at) {
  if (Array.isArray(v)) for (const x of v) propTimes(x, at);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) k === "t" && typeof x === "number" ? at(x) : propTimes(x, at);
}

// Screen rhythm on the compiled timeline: the longest stretches where nothing new happens on
// screen (no scene, cue, shot or overlay), and runs of the same transition. Warnings only.
export function rhythmGate(timeline, config) {
  const g = { ...GATE_DEFAULTS, ...(config.gates ?? {}) };
  const out = [];
  const events = [];
  for (const sc of timeline.scenes) {
    const at = (t) => { if (t >= 0 && t <= sc.duration) events.push({ t: sc.start + t, scene: sc.id }); };
    at(0);
    for (const t of Object.values(sc.cues ?? {})) at(t);
    for (const sh of sc.shots ?? []) at(sh.t);
    for (const o of sc.overlays ?? []) at(o.t);
    propTimes(sc.props, at);
  }
  events.sort((a, b) => a.t - b.t);
  const end = { t: timeline.duration, scene: timeline.scenes.at(-1)?.id };
  const gaps = [...events, end].slice(1).map((e, i) => ({ from: events[i], to: e, len: e.t - events[i].t }))
    .filter((x) => x.len > g.maxStill && x.from.scene !== "credits" && timeline.scenes.find((s) => s.id === x.from.scene)?.type !== "sources");
  for (const x of gaps.sort((a, b) => b.len - a.len).slice(0, 5)) {
    out.push(issue("warn", "rhythm", `${x.len.toFixed(1)}s with nothing new on screen from ${x.from.t.toFixed(1)}s (scene "${x.from.scene}") — add a cue, shot or overlay (max ${g.maxStill}s)`));
  }
  const types = timeline.scenes.slice(1).map((s) => s.transitionIn?.type);
  // Cuts between scenes on the same device are the device staying put, not a transition.
  const onDevice = (i) => timeline.scenes[i + 1].type === "device" && timeline.scenes[i].type === "device";
  let run = 1;
  for (let i = 1; i < types.length; i++) {
    run = types[i] === types[i - 1] && !onDevice(i) ? run + 1 : 1;
    if (run === g.maxSameTransitionRun + 1) out.push(issue("warn", "rhythm", `${run}+ consecutive "${types[i]}" transitions ending at "${timeline.scenes[i + 1].id}" — vary them at chapter turns`));
  }
  return out;
}

// A product demo is read on its results: after a card opens, a page turns or the camera lands on
// a result, it has to hold long enough to be read before the next step moves it on.
export const DEVICE_HOLD = 1.0;
export function deviceGate(timeline, config) {
  const hold = config.gates?.deviceHold ?? DEVICE_HOLD;
  const out = [];
  for (const sc of timeline.scenes) {
    if (sc.type !== "device") continue;
    const steps = sc.props.steps ?? [];
    for (const [i, st] of steps.entries()) {
      if (!(st.expand || st.screen !== undefined || st.camera === "result")) continue;
      const arrive = st.t + (st.tap ? 0.25 : 0) + 0.55;
      const next = steps[i + 1]?.t ?? sc.duration;
      if (next - arrive < hold) out.push(issue("warn", "device", `scene "${sc.id}" step ${i} (${st.t}s): the result holds ${Math.max(0, next - arrive).toFixed(2)}s before ${steps[i + 1] ? `step ${i + 1}` : "the scene ends"} — give it ${hold}s+ (gates.deviceHold)`));
    }
  }
  return out;
}

// Audience-question order: every narrated scene answers the question the viewer has right now
// ("what is it?" → "why?" → "so what?"). Writing it down catches scenes that answer nothing.
export function questionGate(script) {
  const missing = script.scenes.filter((s) => (s.narration || s.lines?.length) && s.beat !== "credits" && s.id !== "credits" && !s.question?.trim()).map((s) => s.id);
  return missing.length ? [issue("warn", "question", `scene(s) without the audience question they answer: ${missing.join(", ")} — add "question" (see stages/script.md)`)] : [];
}

// Three lines, three jobs: narration explains, on-screen text names the point in a few words, the
// picture proves it. Screen text that repeats the narration word for word is read twice.
const SCREEN_KEYS = new Set(["text", "title", "subtitle", "label", "headline", "kicker", "caption", "body"]);
function screenTexts(v, out = []) {
  if (Array.isArray(v)) for (const x of v) screenTexts(x, out);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) typeof x === "string" ? SCREEN_KEYS.has(k) && out.push(x) : screenTexts(x, out);
  return out;
}

export function echoGate(timeline, config) {
  const g = { ...GATE_DEFAULTS, ...(config.gates ?? {}) };
  const out = [];
  for (const sc of timeline.scenes) {
    if (sc.type === "quote" || sc.type === "sources" || sc.id === "credits") continue; // a quote is read aloud on purpose
    const said = normalizeForMatch((sc.lines ?? []).map((l) => l.text).join(""));
    if (!said) continue;
    const echoes = [...new Set(screenTexts([sc.props, sc.overlays, sc.header]))].filter((t) => { const n = normalizeForMatch(t); return n.length >= g.echoMinChars && said.includes(n); });
    for (const t of echoes.slice(0, 3)) out.push(issue("warn", "echo", `scene "${sc.id}": on-screen "${t}" repeats the narration verbatim — keep the screen to the key words (gates.echoMinChars ${g.echoMinChars})`));
  }
  return out;
}

export function summarize(issues) {
  return { errors: issues.filter((i) => i.level === "error"), warnings: issues.filter((i) => i.level === "warn") };
}
