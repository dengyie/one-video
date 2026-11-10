// Timeline compiler: script + storyboard + measured timings → plan/timeline.json.
// The Remotion template reads only this file, so every timing decision lives here.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeForMatch, spokenLength } from "./text.mjs";
import { styleDef } from "./project.mjs";
import { collectIcons, resolveIcon } from "./icons.mjs";
import { resolveCountry } from "./geo.mjs";
import { entryAvailable, entryPath, isMonoDark, loadCatalog, resolveEntry, tintLottie } from "./library.mjs";
import { parseWav } from "./wav.mjs";
import { countFrames, depthPath, framesDir, lumaPath } from "./assets.mjs";
import { beatsFile, snapToBar, snapToBeat } from "./beats.mjs";
import { boxMean, depthAt, dodgeX, hexLuminance, lumaAt, scrimFor, subjectFocus, subjectShare, wordBox } from "./subject.mjs";

export const DIMENSIONS = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };
export const DEFAULT_HOLD = 0.5;
export const SILENT_SCENE_DEFAULT = 4;
// Phrase cues fire this much before the word is spoken: the eye should land on a number as the
// voice says it, and a reveal takes a few frames to read.
export const CUE_LEAD = 0.2;

// Find a phrase across a scene's caption lines and return its spoken time (scene-relative).
// Time inside a line is interpolated by spoken syllables (a digit takes longer to say than it
// takes to write), which is accurate to ~0.2s for TTS speech.
export function phraseTime(lines, phrase) {
  const needle = normalizeForMatch(phrase);
  if (!needle) return null;
  const map = [];
  let hay = "";
  lines.forEach((l, li) => {
    const n = normalizeForMatch(l.text);
    for (let i = 0; i < n.length; i++) map.push([li, i, n.length]);
    hay += n;
  });
  const idx = hay.indexOf(needle);
  if (idx < 0) return null;
  const [li, pos] = map[idx];
  const l = lines[li];
  const n = normalizeForMatch(l.text);
  const share = spokenLength(n.slice(0, pos)) / Math.max(1e-6, spokenLength(n));
  return l.start + (l.end - l.start) * (Number.isFinite(share) ? Math.min(1, share) : 0);
}

export function resolveAt(at, lines, duration) {
  if (typeof at === "number") return { t: at < 0 ? duration + at : at };
  const spec = typeof at === "string" ? { phrase: at, offset: 0 } : at ?? {};
  if (typeof spec.phrase !== "string") return { error: `invalid cue ${JSON.stringify(at)}` };
  const t = phraseTime(lines, spec.phrase);
  if (t === null) return { error: `phrase "${spec.phrase}" not found in narration` };
  return { t: t - CUE_LEAD + (spec.offset ?? 0) };
}

// Seconds each transition overlaps the two scenes it joins (half before the cut, half after).
export const TRANSITION_DURATION = { fade: 0.5, slide: 0.45, push: 0.5, whip: 0.32, zoom: 0.45, punch: 0.36, iris: 0.6, wipe: 0.5, clock: 0.6, dip: 0.7, through: 0.8, cut: 0 };
export const CAMERA_DEFAULT = { move: "drift", amount: 1 };

export const normTransition = (t) => (t == null ? null : typeof t === "string" ? { type: t } : t);

// The boundary between two scenes is one transition: the incoming scene's enter wins, then the
// outgoing scene's exit, then the style's default. Narration never moves; only visuals overlap.
export function boundaryTransition(prev, next, theme, fps) {
  // One device across several scenes stays put: the screen changes, the device never re-enters.
  const sameDevice = prev.type === "device" && next.type === "device" && (prev.props?.device ?? null) === (next.props?.device ?? null);
  const spec = normTransition(next.enter) ?? normTransition(prev.exit) ?? (sameDevice ? { type: "cut" } : null) ?? normTransition(theme.transition) ?? { type: "fade" };
  const want = Math.round((spec.duration ?? TRANSITION_DURATION[spec.type] ?? 0.5) * fps);
  // Never let a transition eat more than 40% of either scene.
  const frames = spec.type === "cut" ? 0 : Math.max(2, Math.min(want, Math.floor(prev.durationInFrames * 0.4), Math.floor(next.durationInFrames * 0.4)));
  const lead = Math.floor(frames / 2);
  return { type: spec.type, frames, lead, direction: spec.direction ?? "left", sfx: spec.sfx, ...(spec.focus ? { focus: spec.focus } : {}) };
}

const clampT = (t, d) => Math.max(0, Math.min(d, t));
const r3 = (x) => Math.round(x * 1000) / 1000;
const normCamera = (c) => (c == null ? null : typeof c === "string" ? { move: c } : c);

// config.sfx.transition: one sound for every boundary, or a map by transition type ("*" = rest).
// sfx.transition: "auto" maps each transition type to a library category that fits its motion.
export const AUTO_TRANSITION_SFX = { "*": "whoosh-soft", fade: null, dip: null, slide: "whoosh-soft", push: "whoosh-fast", wipe: "swish", whip: "whip", zoom: "whoosh-cinematic", punch: "impact", iris: "swish", clock: "swish", through: "whoosh-cinematic" };

// Sound name → public/ path: "synth:tick" (force the procedural sound) becomes sfx/synth-tick.wav.
export const sfxFile = (name) => `sfx/${name.replace(/[^a-z0-9-]/gi, "-")}.wav`;

export function transitionSfx(cfg, type) {
  if (!cfg || type === "cut") return null;
  if (cfg === "auto") cfg = AUTO_TRANSITION_SFX;
  if (typeof cfg === "string") return cfg;
  return cfg[type] !== undefined ? cfg[type] : cfg["*"] ?? null;
}

// Overlay sounds: an overlay's `sfx` names one, "auto" picks by type, null mutes; with
// config.sfx.overlays = "auto" every overlay without its own `sfx` gets the auto sound.
export const OVERLAY_SFX = { word: "ui-pop", icon: "ui-pop", burst: "ui-pop", confetti: "success-sting", arrow: "swish", mark: "marker", callout: "click", stamp: "impact", "lower-third": "whoosh-soft", spotlight: "swell", flash: "boom", image: "ui-pop", lottie: "ui-pop" };
export function overlaySound(ov, cfg) {
  const s = ov.sfx === undefined ? (cfg?.overlays === "auto" ? "auto" : null) : ov.sfx;
  if (!s) return null;
  const name = typeof s === "object" ? s.sound : s;
  return { sound: name === "auto" ? OVERLAY_SFX[ov.type] ?? null : name, volume: typeof s === "object" ? s.volume : undefined };
}

// config.sfx.motion = "auto": the picture's own moves make sound. A canvas flight whooshes (a long
// one cinematically), a hard cut or a slammed word lands with an impact, a push-in breathes a soft
// whoosh, footage ramping back up to speed rushes. Each role's variants rotate through the library.
export const MOTION_SFX = { fly: "whoosh-soft", flyLong: "whoosh-cinematic", cut: "impact", push: "whoosh-soft", slam: "impact", ramp: "whoosh-cinematic", tap: "click", expand: "whoosh-soft", page: "swish", still: "tick" };
const MOTION_GAIN = { fly: 0.8, flyLong: 0.9, cut: 0.5, push: 0.45, slam: 0.7, ramp: 0.85, tap: 0.7, expand: 0.55, page: 0.5, still: 0.35 };
const slamWord = (ov) => ov.type === "word" && (ov.style ?? "slam") === "slam";

// Motion events of a compiled scene, in absolute seconds.
export function motionCues(sc) {
  const out = [];
  const at = (t, role) => out.push({ role, at: r3(sc.start + Math.max(0, t)) });
  // Stop 0 frames the opening (and an inherited canvas's join), so it makes no sound.
  if (sc.type === "canvas") for (const [i, st] of (sc.props.path ?? []).entries()) {
    if (i === 0 || !((st.t ?? 0) > 0)) continue;
    if (st.cut) at(st.t, "cut"); else at(st.t - 0.05, (st.fly ?? 0.9) >= 1.3 ? "flyLong" : "fly");
  }
  for (const [i, sh] of (sc.shots ?? []).entries()) {
    if (i === 0 || sh.t <= 0) continue;
    if (sh.cut) at(sh.t, "cut");
    else if (Math.abs(sh.zoom - sc.shots[i - 1].zoom) >= 0.12) at(sh.t, "push");
  }
  for (const ov of sc.overlays ?? []) if (slamWord(ov)) at(ov.t, "slam");
  // A device taps, opens cards and turns pages; a match cut ticks on every still.
  if (sc.type === "device") for (const st of sc.props.steps ?? []) {
    if (st.tap) at(st.t, "tap");
    if (st.expand) at(st.t + (st.tap ? 0.25 : 0), "expand");
    else if (st.screen !== undefined && !st.tap) at(st.t, "page");
  }
  if (sc.type === "match-cut") for (const [i, it] of (sc.props.items ?? []).entries()) if (i) at(it.t, "still");
  if (sc.type === "footage") {
    let speed = 1;
    for (const r of sc.props.ramp ?? []) { if (speed < 1 && r.speed > 1.3) at((r.t ?? 0) - 0.15, "ramp"); speed = r.speed; }
    // The inserted UI turning a page or scrolling.
    for (const st of sc.props.screen?.steps ?? []) at(st.t, "page");
  }
  return out.sort((a, b) => a.at - b.at);
}

// The library variants of a sound category present on this host, else the category itself.
export function sfxVariants(cat, catalog) {
  const ids = catalog.entries.filter((e) => (e.kind ?? "sfx") === "sfx" && e.category === cat && entryAvailable(e)).map((e) => e.id).sort();
  return ids.length ? ids : [cat];
}

// Scene types that paint the whole frame themselves (no theme background shows through).
const OPAQUE_TYPES = new Set(["media", "focus", "split", "footage", "parallax", "match-cut"]);

// Auto shot track: one framing per caption line, alternating moves and hard cuts, never far
// enough in to lose a header or a card at the edge.
export const AUTO_SHOTS = [
  { zoom: 1, x: 0.5, y: 0.5 },
  { zoom: 1.12, x: 0.44, y: 0.47 },
  { zoom: 1.07, x: 0.56, y: 0.53, rotate: 0.4 },
  { zoom: 1.16, x: 0.5, y: 0.45 },
];

// When something happens inside a scene: a named cue, a phrase / seconds (`at`), or the nth
// music beat counted from the scene start ({ beat: n }). Returns scene-relative seconds.
export function resolveWhen(spec, { cues, lines, duration, start = 0, beats = [] }) {
  if (spec?.cue !== undefined) return cues[spec.cue] !== undefined ? { t: cues[spec.cue] + (spec.offset ?? 0) } : { error: `unknown cue "${spec.cue}"` };
  const at = spec?.at ?? 0;
  if (at && typeof at === "object" && at.beat !== undefined) {
    const local = beats.filter((b) => b >= start - 1e-3).map((b) => b - start);
    return local[at.beat] !== undefined ? { t: local[at.beat] + (at.offset ?? 0) } : { error: `beat ${at.beat} is past the music` };
  }
  return resolveAt(at, lines, duration);
}

// Storyboard shots → compiled Shot[]: `focus: [x, y, w, h]` frames a region (zoom to fit it with
// a margin), otherwise x/y/zoom directly. Times snap to a beat within 0.12 s when beats exist;
// a hard cut prefers the bar's downbeat within 0.25 s.
export function compileShots(spec, ctx) {
  const { lines, duration, start, beats, snap } = ctx;
  const out = [];
  const errors = [];
  const list = spec === "auto" || spec?.auto
    ? lines.map((l, i) => ({ ...AUTO_SHOTS[i % AUTO_SHOTS.length], at: i ? Math.max(0, l.start - CUE_LEAD) : 0, cut: i % 2 === 0 && i > 0, ...(typeof spec === "object" ? spec.each ?? {} : {}) }))
    : Array.isArray(spec) ? spec : [];
  for (const [k, sh] of list.entries()) {
    const res = resolveWhen(sh, ctx);
    if (res.error) { errors.push(`shot ${k}: ${res.error}`); continue; }
    let t = clampT(res.t, duration);
    if (snap && beats.length && sh.snap !== false) t = (sh.cut ? snapToBar(start + t, beats, ctx.downbeats) : snapToBeat(start + t, beats, 0.12)) - start;
    let { zoom = 1, x = 0.5, y = 0.5 } = sh;
    if (Array.isArray(sh.focus)) {
      const [fx, fy, fw, fh] = sh.focus;
      zoom = sh.zoom ?? Math.min(3, Math.max(1, 0.8 / Math.max(fw, fh)));
      x = fx + fw / 2; y = fy + fh / 2;
    }
    out.push({ t: r3(clampT(t, duration)), zoom: r3(zoom), x: r3(x), y: r3(y), rotate: r3(sh.rotate ?? 0), cut: Boolean(sh.cut), ease: r3(sh.ease ?? 0.6) });
  }
  out.sort((a, b) => a.t - b.t);
  return { shots: out, errors };
}

// An inherited canvas item arrives in its final form: already shown, morphs applied.
const settled = (it) => {
  const { morph = [], at: _a, cue: _c, ...rest } = it;
  const last = morph.length ? morph[morph.length - 1] : {};
  const { at: _ma, cue: _mc, t: _mt, ...state } = last;
  return { ...rest, ...state, t: 0, settled: true };
};

// Resolve every `at`/`cue` in a canvas / footage scene's props to `t` (scene seconds).
function resolvePropTimes(type, props, ctx, errors, where) {
  // `beat`: camera moves snap like shots ("beat", or "bar" for cuts and speed-ups).
  const fix = (o, label, beat) => {
    if (!o || (o.at === undefined && o.cue === undefined)) return;
    const res = resolveWhen(o, ctx);
    if (res.error) { errors.push(`${where} ${label}: ${res.error}`); return; }
    let t = clampT(res.t, ctx.duration);
    if (beat && ctx.snap && ctx.beats?.length && o.snap !== false) {
      const abs = ctx.start + t;
      t = (beat === "bar" ? snapToBar(abs, ctx.beats, ctx.downbeats) : snapToBeat(abs, ctx.beats, 0.12)) - ctx.start;
    }
    o.t = r3(clampT(t, ctx.duration));
  };
  if (type === "canvas") {
    for (const [i, it] of (props.items ?? []).entries()) { fix(it, `item ${it.id ?? i}`); for (const [j, m] of (it.morph ?? []).entries()) fix(m, `item ${it.id ?? i} morph ${j}`); }
    for (const [i, v] of (props.path ?? []).entries()) fix(v, `path ${i}`, i === 0 ? null : v.cut ? "bar" : "beat");
    for (const [i, l] of (props.links ?? []).entries()) fix(l, `link ${i}`);
  }
  if (type === "footage") {
    for (const [i, r] of (props.ramp ?? []).entries()) fix(r, `ramp ${i}`, r.speed > 1.3 ? "bar" : null);
    fix(props.title, "title");
  }
  if (type === "parallax") fix(props.title, "title");
  if (type === "footage") {
    fix(props.screen, "screen"); fix(props.windows, "windows");
    // A step without a time comes 1.2s after the one before it.
    let last = props.screen?.t ?? 0;
    for (const [i, st] of (props.screen?.steps ?? []).entries()) { fix(st, `screen step ${i}`); st.t ??= r3(Math.min(ctx.duration, last + 1.2)); last = st.t; }
    props.screen?.steps?.sort((a, b) => a.t - b.t);
  }
  if (type === "device") {
    // Taps land on the beat; steps without a time spread over the first three quarters.
    const steps = props.steps ?? [];
    steps.forEach((st, i) => { fix(st, `step ${i}`, st.tap ? "beat" : null); st.t ??= r3(Math.min(ctx.duration, 0.6 + (i * Math.max(0, 0.75 * ctx.duration - 0.6)) / Math.max(1, steps.length - 1 || 1))); });
    steps.sort((a, b) => a.t - b.t);
  }
  if (type === "match-cut") {
    // `every`: seconds per still, or "beat" / "bar" to cut on the music from `from` seconds on.
    const items = props.items ?? [], every = props.every ?? 0.5, from = props.from ?? 0;
    const grid = every === "bar" ? ctx.downbeats : every === "beat" ? ctx.beats : null;
    const local = (grid ?? []).map((b) => b - ctx.start).filter((b) => b >= from - 1e-3 && b < ctx.duration);
    if (grid && local.length < items.length) errors.push(`${where} match-cut: ${items.length} stills but only ${local.length} ${every}s from ${from}s in the scene (no music beats? use every: <seconds>)`);
    const step = typeof every === "number" ? every : 0.5;
    items.forEach((it, i) => { fix(it, `item ${i}`, "beat"); it.t ??= r3(grid ? local[i] ?? from + i * step : from + i * step); });
  }
}

// Device steps may name a region by the capture's rects (onevideo capture --rects): a tap lands
// on its centre, expand/focus take the rect. Names are looked up on the screen showing at the step.
export function resolveDeviceRects(props, assetById, errors, where) {
  const screens = props.screens ?? [];
  const idx = (s) => (typeof s === "number" ? s : screens.findIndex((x) => x.id === s));
  let cur = 0;
  const rect = (name, label) => {
    const r = assetById.get(screens[cur]?.asset)?.rects?.[name];
    if (!r) errors.push(`${where} ${label}: no rect "${name}" on screen ${screens[cur]?.id ?? cur} (rects come from onevideo capture --rects)`);
    return r ?? [0.25, 0.25, 0.5, 0.5];
  };
  for (const [i, st] of (props.steps ?? []).entries()) {
    if (st.screen !== undefined) {
      if (idx(st.screen) < 0 || idx(st.screen) >= screens.length) errors.push(`${where} step ${i}: unknown screen "${st.screen}"`);
      else cur = idx(st.screen);
    }
    if (typeof st.tap === "string") { const r = rect(st.tap, `step ${i} tap`); st.tap = [r3(r[0] + r[2] / 2), r3(r[1] + r[3] / 2)]; }
    if (typeof st.focus === "string") st.focus = rect(st.focus, `step ${i} focus`);
    if (st.expand && typeof st.expand.rect === "string") st.expand.rect = rect(st.expand.rect, `step ${i} expand`);
    if (st.expand && typeof st.expand.to === "string") st.expand.to = rect(st.expand.to, `step ${i} expand.to`);
    // A tap that opens a card with no rect of its own grows the region around the tap.
    if (st.expand && !st.expand.rect && Array.isArray(st.tap)) st.expand.rect = [r3(Math.max(0, st.tap[0] - 0.2)), r3(Math.max(0, st.tap[1] - 0.06)), 0.4, 0.12];
  }
}

// Moments a viewer feels as hits, in seconds with a weight: scene boundaries, hard shot cuts and
// slammed words (half weight).
export function hardCuts(timeline) {
  const out = [];
  timeline.scenes.forEach((sc, i) => {
    if (i) out.push({ at: sc.from / timeline.fps, w: 1 });
    for (const sh of sc.shots ?? []) if (sh.cut && sh.t > 0) out.push({ at: sc.start + sh.t, w: 1 });
    for (const o of sc.overlays ?? []) if (slamWord(o)) out.push({ at: sc.start + o.t, w: 0.5 });
  });
  return out;
}

// Track start (0 to one bar, 10 ms steps) that puts the weighted hits nearest the downbeats;
// each hit counts at most 0.3 s off, so one stray hit can't drag the rest.
export function bestOffset(hits, downbeats) {
  if (!hits.length || downbeats.length < 2) return 0;
  const bar = downbeats[1] - downbeats[0];
  const near = (t) => downbeats.reduce((m, d) => Math.min(m, Math.abs(d - t)), Infinity);
  let best = { off: 0, score: Infinity };
  for (let off = 0; off < bar; off = r3(off + 0.01)) {
    const score = hits.reduce((s, h) => s + h.w * Math.min(0.3, near(h.at + off)), 0);
    if (score < best.score - 1e-6) best = { off, score };
  }
  return best.off;
}

const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

// The caption band (screen) in the scene's own frame coordinates under the shot framing at t.
export function captionBand(shots, t, portrait = false) {
  const sh = [...(shots ?? [])].reverse().find((s) => s.t <= t) ?? { zoom: 1, x: 0.5, y: 0.5 };
  const back = (v, c) => c + (v - 0.5) / sh.zoom;
  const [y0, y1] = portrait ? [0.74, 0.86] : [0.84, 0.96];
  return [back(0.2, sh.x), back(y0, sh.y), back(0.8, sh.x), back(y1, sh.y)];
}

export function compileTimeline({ config, script, storyboard, timings, assets, research, root }) {
  const errors = [];
  const warnings = [];
  const fps = config.fps ?? 30;
  const [width, height] = config.width && config.height ? [config.width, config.height] : DIMENSIONS[config.aspect ?? "16:9"] ?? DIMENSIONS["16:9"];
  const theme = mergeTheme(styleDef(config.style ?? "midnight-data"), config.theme);
  const scriptById = new Map(script.scenes.map((s) => [s.id, s]));
  const assetById = new Map((assets?.items ?? []).map((a) => [a.id, a]));
  const usedAssets = {};
  const icons = {};
  const lottie = {};
  const libraryCredits = [];
  let catalog = null;
  const scenes = [];
  const captions = [];
  const narration = [];
  const sfx = [];
  const chapters = [];
  let frame = 0;

  const sfxCfg = { transition: null, volume: 0.5, ...(config.sfx ?? {}) };
  // Beat grid of the music, cached by `onevideo music` / render (see beats.mjs).
  const musicSrc = config.music?.file ?? "music/bgm.wav";
  const beatsAt = root ? beatsFile(join(root, "public", musicSrc)) : null;
  const grid = config.music?.enabled !== false && beatsAt && existsSync(beatsAt) ? JSON.parse(readFileSync(beatsAt, "utf8")) : {};
  // music.offset starts the track that many seconds in; "auto" picks the start that lands the
  // hard cuts on downbeats (a dry compile without snapping says where they fall).
  let offset = typeof config.music?.offset === "number" ? config.music.offset : 0;
  if (config.music?.offset === "auto" && grid.downbeats?.length) {
    const dry = compileTimeline({ config: { ...config, music: { ...config.music, offset: 0 }, beats: { ...config.beats, snap: false } }, script, storyboard, timings, assets, research, root });
    if (dry.timeline) offset = bestOffset(hardCuts(dry.timeline), grid.downbeats);
  }
  const shift = (list) => (list ?? []).map((b) => r3(b - offset)).filter((b) => b >= 0);
  const beats = shift(grid.beats);
  const downbeats = shift(grid.downbeats);
  const snap = config.beats?.snap !== false;
  let lastCanvas = null;

  for (const sb of storyboard.scenes) {
    const sc = scriptById.get(sb.id);
    if (!sc) { errors.push(`storyboard scene "${sb.id}" has no script entry`); continue; }
    const tm = timings?.scenes?.[sb.id];
    if (!tm && (sc.narration || sc.lines)) { errors.push(`scene "${sb.id}" has narration but no audio; run: onevideo tts`); continue; }
    const lines = tm?.lines ?? [];
    const speech = tm?.duration ?? 0;
    let duration = speech ? speech + (sb.hold ?? DEFAULT_HOLD) : sb.duration ?? SILENT_SCENE_DEFAULT;
    if (sb.duration && speech && sb.duration < speech) warnings.push(`scene "${sb.id}": duration ${sb.duration}s is shorter than its narration (${speech.toFixed(2)}s); using narration length`);
    if (sb.duration) duration = Math.max(duration, sb.duration);
    if (sb.minDuration) duration = Math.max(duration, sb.minDuration);
    const durationInFrames = Math.ceil(duration * fps);
    duration = durationInFrames / fps;
    const from = frame;
    const start = from / fps;

    const cues = {};
    for (const [name, at] of Object.entries(sb.cues ?? {})) {
      const res = resolveAt(at, lines, duration);
      if (res.error) { errors.push(`scene "${sb.id}" cue "${name}": ${res.error}`); continue; }
      cues[name] = r3(clampT(res.t, duration));
    }
    for (const fx of sb.sfx ?? []) {
      const res = resolveAt(fx.at ?? 0, lines, duration);
      if (res.error) { errors.push(`scene "${sb.id}" sfx "${fx.sound}": ${res.error}`); continue; }
      sfx.push({ sound: fx.sound, src: sfxFile(fx.sound), at: r3(start + clampT(res.t, duration)), volume: fx.volume ?? sfxCfg.volume });
    }

    const overlays = [];
    for (const [k, ov] of (sb.overlays ?? []).entries()) {
      const where = `scene "${sb.id}" overlay ${k} (${ov.type})`;
      const res = resolveAt(ov.at ?? 0, lines, duration);
      if (res.error) { errors.push(`${where}: ${res.error}`); continue; }
      const t = clampT(res.t, duration);
      const { at, duration: d, sfx: _sfx, ...rest } = ov;
      const o = { ...structuredClone(rest), t: r3(t), end: r3(d ? Math.min(duration + 0.5, t + d) : duration + 0.5) };
      if (ov.type === "lottie") {
        const src = ov.src;
        if (!lottie[src]) {
          catalog ??= loadCatalog();
          const hit = typeof src === "string" ? resolveEntry(src, catalog, "lottie") : null;
          const file = hit ? entryPath(hit.entry) : root && typeof src === "string" && src.endsWith(".json") ? join(root, "public", src) : null;
          if (!file || !existsSync(file)) { errors.push(`${where}: unknown lottie "${src}" (library id/category, see onevideo lib list --kind lottie, or a .json under public/)`); continue; }
          lottie[src] = JSON.parse(readFileSync(file, "utf8"));
          const line = hit && libraryCredit(hit.entry);
          if (line && !libraryCredits.includes(line)) libraryCredits.push(line);
        }
        // Explicit tint, or black line icons tinted to the theme's text colour so they read on dark backgrounds.
        const tint = ov.tint ?? (isMonoDark(lottie[src]) ? theme.colors?.text : null);
        if (tint) {
          const key = `${src}#${tint}`;
          try { lottie[key] ??= tintLottie(lottie[src], tint); } catch (e) { errors.push(`${where}: ${e.message}`); continue; }
          o.src = key;
          delete o.tint;
        }
      }
      // With motion sounds on, a slammed word lands on an impact from the motion pass instead.
      const snd = sfxCfg.motion === "auto" && slamWord(ov) && ov.sfx === undefined ? null : overlaySound(ov, sfxCfg);
      if (snd?.sound) sfx.push({ sound: snd.sound, src: sfxFile(snd.sound), at: r3(start + t), volume: snd.volume ?? sfxCfg.volume });
      overlays.push(o);
    }

    const props = structuredClone(sb.props ?? {});
    const ctx = { cues, lines, duration, start, beats, downbeats, snap };
    // A canvas scene with `inherit` continues the previous canvas: same world, camera picks up
    // where it left off (cut into it for a seamless join).
    if (sb.type === "canvas" && props.inherit) {
      if (!lastCanvas) errors.push(`scene "${sb.id}": canvas inherit needs an earlier canvas scene`);
      else {
        const own = new Map((props.items ?? []).map((it) => [it.id, it]));
        props.items = [...lastCanvas.items.filter((it) => !own.has(it.id)).map(settled), ...(props.items ?? [])];
        const end = lastCanvas.path?.[lastCanvas.path.length - 1];
        if (end) props.path = [{ ...end, at: 0, cue: undefined, cut: true }, ...(props.path ?? [])];
      }
    }
    resolvePropTimes(sb.type, props, ctx, errors, `scene "${sb.id}"`);
    if (sb.type === "device") resolveDeviceRects(props, assetById, errors, `scene "${sb.id}"`);
    if (sb.type === "canvas") lastCanvas = { items: props.items ?? [], path: props.path ?? [] };
    let shots;
    if (sb.shots) {
      const res = compileShots(sb.shots, ctx);
      res.errors.forEach((e) => errors.push(`scene "${sb.id}" ${e}`));
      if (res.shots.length) shots = res.shots;
    }
    if (sb.type === "sources" && !props.items?.length && props.auto !== false) props.items = sourceList(research, assets, libraryCredits);
    if (sb.type === "map") for (const h of props.highlight ?? []) {
      const id = resolveCountry(h.id);
      if (id) h.id = id; else errors.push(`scene "${sb.id}" map highlight: unknown country "${h.id}" (use a Natural Earth numeric id, ISO alpha-2 or English name)`);
    }
    for (const name of collectIcons([props, overlays])) {
      if (icons[name]) continue;
      const icon = resolveIcon(name);
      if (icon) icons[name] = icon; else errors.push(`scene "${sb.id}" uses unknown icon "${name}" (Lucide name or flag:<iso2>)`);
    }
    if (sb.type === "unit-grid" && !icons[props.icon ?? "user-round"]) { const icon = resolveIcon(props.icon ?? "user-round"); if (icon) icons[props.icon ?? "user-round"] = icon; }
    const refs = collectAssetRefs([props, overlays]);
    if (sb.backdrop) refs.add(sb.backdrop.asset);
    for (const id of refs) {
      const a = assetById.get(id);
      if (!a) { errors.push(`scene "${sb.id}" references unknown asset "${id}"`); continue; }
      if (!a.file) { errors.push(`asset "${id}" not fetched yet; run: onevideo assets fetch`); continue; }
      if (root && !existsSync(join(root, "public", a.file))) errors.push(`asset "${id}" file missing: public/${a.file}; run: onevideo assets fetch`);
      usedAssets[id] = { src: a.file, kind: a.kind, credit: credit(a) };
      // A full-page capture is this many of its viewport tall (what a scrolling screen slides over).
      const vp = a.capture?.full && a.capture.viewport;
      if (vp && a.width && a.height) usedAssets[id].pages = r3(a.height / a.width / (vp[1] / vp[0]));
      if (root && existsSync(join(root, "public", depthPath(a)))) {
        usedAssets[id].depth = depthPath(a);
        const meta = join(root, "public", depthPath(a), "meta.json");
        if (a.kind === "video" && existsSync(meta)) { const m = JSON.parse(readFileSync(meta, "utf8")); Object.assign(usedAssets[id], { depthStep: m.step, depthFrames: m.frames }); }
      }
      if (root && existsSync(join(root, "public", lumaPath(a)))) usedAssets[id].luma = lumaPath(a);
      if (a.kind === "video" && root) {
        const frames = countFrames(join(root, "public", framesDir(a.file)));
        if (frames) Object.assign(usedAssets[id], { seq: framesDir(a.file), frames, fps: 30 });
        else warnings.push(`asset "${id}": no frame sequence, falls back to <OffthreadVideo> (needs memory); run: onevideo render (extracts it)`);
      }
    }

    for (const l of lines) {
      captions.push({ scene: sb.id, text: l.text, start: r3(start + l.start), end: r3(start + l.end) });
      narration.push([r3(start + l.start), r3(start + l.end)]);
    }
    const chapter = sb.chapter ?? sc.chapter;
    if (chapter) chapters.push({ title: chapter, start: r3(start) });

    scenes.push({
      id: sb.id,
      type: sb.type,
      from,
      durationInFrames,
      start: r3(start),
      duration: r3(duration),
      audio: tm?.file ?? null,
      enter: sb.enter ?? null,
      exit: sb.exit ?? null,
      transitionIn: null,
      transitionOut: null,
      camera: { ...CAMERA_DEFAULT, ...(normCamera(theme.camera) ?? {}), ...(normCamera(sb.camera) ?? {}) },
      opaque: Boolean(sb.backdrop) || OPAQUE_TYPES.has(sb.type),
      header: sb.header ?? null,
      background: sb.background ?? null,
      backdrop: sb.backdrop ? { dim: 0.62, blur: 0, motion: "in", startFrom: 0, ...sb.backdrop } : null,
      captions: sb.captions !== false,
      cues,
      lines: lines.map((l) => ({ text: l.text, start: l.start, end: l.end })),
      props,
      ...(overlays.length ? { overlays } : {}),
      ...(shots ? { shots } : {}),
    });
    frame += durationInFrames;
  }

  const totalFrames = frame;
  // Opening fades up from the background, closing fades out; inner boundaries overlap.
  const edge = (type, d) => ({ type: type === "cut" ? "cut" : "fade", frames: type === "cut" ? 0 : Math.round(d * fps), lead: 0, direction: "left" });
  scenes.forEach((sc, i) => {
    const prev = scenes[i - 1];
    if (!prev) { sc.transitionIn = edge(normTransition(sc.enter)?.type ?? "fade", 0.45); return; }
    const b = boundaryTransition(prev, sc, theme, fps);
    sc.transitionIn = { type: b.type, frames: b.frames, lead: b.lead, direction: b.direction };
    prev.transitionOut = { type: b.type, frames: b.frames, tail: b.frames - b.lead, direction: b.direction, nextOpaque: sc.opaque };
    // Through dives at the outgoing subject: an authored [x, y] on screen, else the depth map's.
    if (b.type === "through") {
      const focus = b.focus ? { x: b.focus[0], y: b.focus[1], layer: "screen" } : subjectFocus(root, prev, usedAssets, fps, width, height);
      if (focus) sc.transitionIn.focus = prev.transitionOut.focus = focus;
    }
    const sound = b.sfx !== undefined ? b.sfx : transitionSfx(sfxCfg.transition, b.type);
    if (sound) sfx.push({ sound, src: sfxFile(sound), at: r3(Math.max(0, (sc.from - b.lead) / fps - 0.06)), volume: sfxCfg.volume * 0.7 });
  });
  // Text over media: a word without an authored x steps aside from the depth subject, and gets a
  // scrim when the background under it leaves less than 4.5:1; a caption line moves to the top
  // while the subject fills the caption band.
  for (const sc of scenes) {
    for (const o of sc.overlays ?? []) {
      if (o.type !== "word") continue;
      const at = Math.min(sc.duration, o.t + 0.3);
      const d = depthAt(root, sc, usedAssets, fps, at);
      if (d && o.x === undefined) { const x = dodgeX(d, o, width, height); if (x !== null) o.x = x; }
      const g = o.scrim === undefined && lumaAt(root, sc, usedAssets, fps, at);
      if (g) {
        const bg = boxMean(g.px, g.w, g.h, wordBox(o, width, height), width, height) * (g.fill ? 1 : 1 - (sc.backdrop?.dim ?? 0));
        const k = scrimFor(hexLuminance(o.color ?? theme.colors?.text), bg);
        if (k) o.scrim = k;
      }
    }
    // A word still on screen when a later one lands on top of it leaves as that one arrives.
    const words = (sc.overlays ?? []).filter((o) => o.type === "word").sort((a, b) => a.t - b.t);
    for (const [i, a] of words.entries()) {
      const b = words.slice(i + 1).find((w) => w.t < a.end && overlaps(wordBox(a, width, height), wordBox(w, width, height)));
      if (b) a.end = r3(Math.max(a.t + 0.4, b.t));
    }
    // A footage title still up when a word lands on it fades out as the word arrives.
    const title = (sc.type === "footage" || sc.type === "parallax") && sc.props.title;
    if (title) {
      const t0 = title.t ?? 0.2, box = wordBox({ ...title, size: title.size ?? 260, y: title.y ?? 0.42 }, width, height);
      const hit = words.find((w) => w.t > t0 && w.t < t0 + (title.duration ?? Infinity) + 0.3 && overlaps(box, wordBox(w, width, height)));
      if (hit) title.duration = r3(Math.max(0.4, hit.t - t0 - 0.3));
    }
    for (const c of captions) {
      if (c.scene !== sc.id) continue;
      const t = (c.start + c.end) / 2 - sc.start;
      const d = depthAt(root, sc, usedAssets, fps, t);
      if (d && subjectShare(d, captionBand(sc.shots, t, height >= width * 1.5), width, height) > 0.25) c.top = true;
    }
  }
  const last = scenes[scenes.length - 1];
  if (last) last.transitionOut = { type: normTransition(last.exit)?.type === "cut" ? "cut" : "fade", frames: normTransition(last.exit)?.type === "cut" ? 0 : Math.round(0.6 * fps), tail: 0, direction: "left", nextOpaque: false };
  if (sfxCfg.motion === "auto") {
    // Motion sounds yield to every authored / transition / overlay sound within 0.2 s, and to each other within 0.25 s.
    catalog ??= loadCatalog();
    const turn = {}, variants = {};
    let last = -Infinity;
    for (const c of scenes.flatMap(motionCues)) {
      if (c.at - last < 0.25 || sfx.some((s) => Math.abs(s.at - c.at) < 0.2)) continue;
      const cat = MOTION_SFX[c.role];
      const v = (variants[cat] ??= sfxVariants(cat, catalog));
      const sound = v[(turn[cat] = (turn[cat] ?? -1) + 1) % v.length];
      sfx.push({ sound, src: sfxFile(sound), at: c.at, volume: r3(sfxCfg.volume * MOTION_GAIN[c.role]), motion: c.role });
      last = c.at;
    }
  }
  sfx.sort((a, b) => a.at - b.at);
  // music.file is a path under public/ (own or licensed track); otherwise the synthesized bgm.wav.
  const music = config.music?.enabled === false ? null : root && existsSync(join(root, "public", musicSrc))
    ? { src: musicSrc, offset, volume: config.music?.volume ?? 0.22, duckTo: config.music?.duckTo ?? 0.07, fade: 1.2, credit: config.music?.file ? config.music?.credit ?? null : "OneVideo 程序化合成" }
    : null;
  if (config.music?.enabled !== false && !music) warnings.push(`no background music (public/${musicSrc})${config.music?.file ? "" : "; run: onevideo music"}`);
  if (config.music?.file && !config.music?.credit) warnings.push("music.file has no music.credit; add the track title/author/license for the publish credits");
  const usedSfx = [...new Set(sfx.map((s) => s.sound))];
  if (root) for (const name of usedSfx) if (!existsSync(join(root, "public", sfxFile(name)))) errors.push(`sfx "${name}" missing: public/${sfxFile(name)}; run: onevideo music`);
  // Library sounds run up to 8 s; the player keeps each one mounted for its real length.
  const sfxLen = {};
  if (root) for (const s of sfx) {
    const f = join(root, "public", s.src);
    if (sfxLen[s.src] === undefined && existsSync(f)) { try { sfxLen[s.src] = r3(parseWav(readFileSync(f)).duration); } catch { sfxLen[s.src] = null; } }
    if (sfxLen[s.src]) s.duration = sfxLen[s.src];
  }

  const timeline = {
    version: 1,
    title: script.title ?? config.title ?? "",
    fps,
    width,
    height,
    aspect: config.aspect ?? "16:9",
    totalFrames,
    duration: r3(totalFrames / fps),
    theme,
    watermark: config.watermark ?? null,
    captions: { enabled: config.captions?.enabled !== false, style: config.captions?.style ?? "line", items: captions },
    narration,
    music,
    sfx,
    chapters,
    assets: usedAssets,
    icons,
    // Only the variants overlays reference (a tinted copy replaces its untinted source).
    lottie: Object.fromEntries(Object.entries(lottie).filter(([k]) => scenes.some((sc) => sc.overlays?.some((o) => o.src === k)))),
    libraryCredits,
    look: config.look ?? theme.look ?? null,
    beats: music ? beats.filter((b) => b <= totalFrames / fps) : [],
    scenes,
  };
  return { timeline, errors, warnings };
}

// Style JSON nests colors/fonts/motion; a project's theme override merges one level deep.
export function mergeTheme(base, over = {}) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) out[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(base[k] ?? {}), ...v } : v;
  return out;
}

// One line per distinct source: "publisher · title · date". Facts first, then extra research.sources.
export function researchSources(research) {
  const seen = new Map();
  for (const s of [...(research?.facts ?? []).map((f) => f.source), ...(research?.sources ?? [])]) {
    if (!s?.title) continue;
    const line = [s.publisher, s.title, s.date].filter(Boolean).join(" · ");
    if (!seen.has(line)) seen.set(line, { line, url: s.url ?? null });
    else if (!seen.get(line).url && s.url) seen.get(line).url = s.url;
  }
  return [...seen.values()];
}

// On-screen credits for the sources scene: research sources, then every asset's attribution.
export function sourceList(research, assets, extra = []) {
  const out = researchSources(research).map((s) => s.line);
  for (const a of assets?.items ?? []) {
    const line = `${a.kind === "video" ? "视频" : "图片"}：${credit(a)}`;
    if (!out.includes(line)) out.push(line);
  }
  for (const line of extra) if (!out.includes(line)) out.push(line);
  return out;
}

// Library entries under an attribution licence (CC BY) owe a credit line in every video using them.
export function libraryCredit(entry) {
  const p = entry?.provenance ?? {};
  if (!/cc[- ]?by/i.test(p.license ?? "")) return null;
  return `动画：${[p.author ?? p.source, "CC BY 4.0"].filter(Boolean).join(" · ")}`;
}

function collectAssetRefs(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => collectAssetRefs(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if ((k === "asset" || k === "avatar" || k === "logo") && typeof x === "string") out.add(x);
      else collectAssetRefs(x, out);
    }
  }
  return out;
}

export function credit(a) {
  if (a.license === "generated") return `AI 生成 · ${a.author ?? "image model"}`;
  return [a.title, a.author, a.license].filter(Boolean).join(" · ");
}
