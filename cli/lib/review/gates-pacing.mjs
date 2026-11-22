// Pacing gates, run on the compiled timeline: the hook, screen rhythm (still stretches and their
// fixes), transition variety, device holds, the audience question and screen text echoing the voice.
import { normalizeForMatch } from "../core/text.mjs";
import { OVERLAY_EFFECTS, REFRAMING, named, propTimes, sameWorld, screenEvents } from "../timeline/index.mjs";
import { LAID_OUT_ZOOM, laidOut, weakMove } from "../timeline/shots.mjs";
import { CUE_LEAD, phraseTime } from "../timeline/cues.mjs";
import { numberReveals } from "./reveals.mjs";
import { GATE_DEFAULTS, issue } from "./issue.mjs";

// Scene types whose picture is the content from the first frame.
const OPENING_VISUAL = new Set(["footage", "media", "photo-stack", "parallax", "focus", "split", "device", "match-cut", "canvas", "map", "tableau"]);
// An element in a list with no cue or time of its own comes in on the default rhythm, right away.
const uncued = (v) => Array.isArray(v)
  ? v.some((x) => (x && typeof x === "object" && !Array.isArray(x) && !Object.keys(x).some((k) => k === "t" || /cue/i.test(k))) || uncued(x))
  : Boolean(v && typeof v === "object" && Object.values(v).some(uncued));

// The hook: the opening scene shows what it is about within the first seconds. A text-led opening
// whose first line, number or sticker waits on a later word leaves the viewer on a backdrop.
export function openingGate(timeline, config) {
  const g = { ...GATE_DEFAULTS, ...(config.gates ?? {}) };
  const sc = timeline.scenes?.[0];
  if (!sc || !g.hookReveal || OPENING_VISUAL.has(sc.type) || sc.header) return [];
  const props = sc.props ?? {};
  if (!/"(t|\w*[cC]ues?)":/.test(JSON.stringify(props)) || uncued(props)) return [];
  const times = [...Object.values(sc.cues ?? {}), ...(sc.overlays ?? []).filter((o) => !OVERLAY_EFFECTS.has(o.type)).map((o) => o.t)];
  propTimes(props, (t) => times.push(t));
  const first = Math.min(...times.filter(Number.isFinite));
  if (!(first > g.hookReveal) || first >= sc.duration) return [];
  // The cue holding it back, and the first words spoken in time to move it to.
  const late = Object.entries(sc.cues ?? {}).find(([, t]) => t === first)?.[0];
  const line = (sc.lines ?? []).find((l) => l.start <= g.hookReveal && linePhrase(l.text));
  const how = late && line ? `move cue "${late}" to "${linePhrase(line.text)}" (${line.start.toFixed(1)}s)` : line ? `cue it on "${linePhrase(line.text)}" (${line.start.toFixed(1)}s)` : "cue it on an earlier word";
  const fix = late && line ? { scene: sc.id, path: ["cues", late], value: linePhrase(line.text) } : null;
  return [issue("warn", "opening", `the first ${first.toFixed(1)}s of "${sc.id}" show only ${sc.backdrop ? "its backdrop" : "the background"} — reveal the hook's main line by ${g.hookReveal}s (${how}, or open on footage; gates.hookReveal)`, { scene: sc.id, from: sc.start, to: sc.start + first, field: "cues" }, fix)];
}

// A line's opening words, up to its first punctuation (12 characters at most): a phrase a cue can name.
const linePhrase = (text) => String(text ?? "").replace(/^[\s"'“‘（(《【]+/, "").split(/[，。、；：！？,.;:!?\s“”"（）()《》【】]/)[0].slice(0, 12);

// The narration line to hang a reveal on in a still stretch [from, to] (timeline seconds): the one
// starting nearest its middle, at least a second from either end. `phrase` is its opening words, a cue value.
// A phrase an earlier line also says would put the cue there, so that line is passed over.
function gapLine(sc, from, to) {
  const mid = (from + to) / 2;
  const lines = (sc?.lines ?? []).map((l) => ({ t: sc.start + l.start, text: String(l.text ?? "") }));
  const fits = lines.map((l, i) => ({ ...l, phrase: linePhrase(l.text) }))
    .filter((l, i) => l.phrase && l.t > from + 1 && l.t < to - 1 && !lines.slice(0, i).some((e) => e.text.includes(l.phrase)));
  const best = fits.sort((a, b) => Math.abs(a.t - mid) - Math.abs(b.t - mid))[0];
  return best ? { t: best.t, phrase: best.phrase } : null;
}

// Stretches longer than maxStill with nothing new on screen (no scene, cue, real shot move or overlay).
function stillGaps(timeline, maxStill) {
  // A shot that barely moves the frame is not something new to look at.
  const events = screenEvents(timeline).filter((e) => !e.weak);
  const end = { t: timeline.duration, scene: timeline.scenes.at(-1)?.id };
  return [...events, end].slice(1).map((e, i) => ({ from: events[i], to: e, len: e.t - events[i].t }))
    .filter((x) => x.len > maxStill && x.from.scene !== "credits" && timeline.scenes.find((s) => s.id === x.from.scene)?.type !== "sources");
}

// A cue that fires after the stretch [x.from, x.to] although its line starts inside it: moved to the
// line's opening words it fires as the line begins. Only offered when that leaves no stretch too long
// between the stretch's start and the cue's old time.
function earlierCue(timeline, sc, x, maxStill) {
  const used = named([sc.props, sc.overlays, sc.shots]);
  const lines = sc.lines ?? [];
  const later = Object.entries(sc.cues ?? {}).filter(([n, t]) => used.has(n) && sc.start + t >= x.to.t - 1e-3).sort((a, b) => a[1] - b[1]);
  for (const [name, t] of later) {
    // The line the cue is said in (an offset can put it before its line starts: then it is not moved).
    const l = lines.findLast((l) => l.start <= t + CUE_LEAD + 1e-3);
    if (!l || t + CUE_LEAD > (l.end ?? Infinity) + 0.1) continue;
    const phrase = linePhrase(l.text);
    const at = phrase && phraseTime(lines, phrase);
    if (!Number.isFinite(at) || Math.abs(at - l.start) > 0.05) continue;
    const nt = Math.max(0, at - CUE_LEAD);
    if (sc.start + nt < x.from.t + 1 || nt > t - 0.3) continue;
    const moved = { ...timeline, scenes: timeline.scenes.map((s) => (s === sc ? { ...s, cues: { ...s.cues, [name]: nt } } : s)) };
    if (stillGaps(moved, maxStill).some((y) => y.from.t < sc.start + t && y.to.t > x.from.t)) continue;
    return { name, phrase, t: sc.start + nt };
  }
  return null;
}

// A written shot in the stretch that barely moves (see weakMove): pushed further it is a move one
// sees. Shots right after it holding its frame follow it, so a hold stays a hold. Charts and cards
// stay within LAID_OUT_ZOOM. Only offered when it leaves fewer stretches too long and none here.
function biggerShot(timeline, sc, x, maxStill) {
  const shots = sc.shots ?? [];
  const cap = laidOut(sc.type) ? LAID_OUT_ZOOM : 3;
  const long = (tl) => stillGaps(tl, maxStill).filter((y) => y.from.scene === sc.id);
  for (let i = 1; i < shots.length; i++) {
    const sh = shots[i], prev = shots[i - 1];
    if (sh.k === undefined || sc.start + sh.t <= x.from.t + 0.5 || sc.start + sh.t >= x.to.t - 0.5 || !weakMove(prev, sh)) continue;
    let j = i + 1;
    while (j < shots.length && shots[j].k !== undefined && !shots[j].cut && ["zoom", "x", "y", "rotate"].every((f) => shots[j][f] === sh[f])) j++;
    const dir = sh.zoom < prev.zoom ? -1 : 1;
    for (const step of [0.06, 0.08, 0.1]) {
      const zoom = Math.round((prev.zoom + dir * step) * 100) / 100;
      if (zoom > cap + 1e-9 || zoom < 1) continue;
      const moved = { ...timeline, scenes: timeline.scenes.map((s) => (s === sc ? { ...s, shots: shots.map((h, n) => (n >= i && n < j ? { ...h, zoom } : h)) } : s)) };
      const after = long(moved);
      if (after.length < long(timeline).length && !after.some((y) => y.from.t < x.to.t && y.to.t > x.from.t)) {
        return { t: sc.start + sh.t, from: sh.zoom, zoom, ks: shots.slice(i, j).map((h) => h.k) };
      }
    }
  }
  return null;
}

// Screen rhythm on the compiled timeline: the longest stretches where nothing new happens on
// screen (no scene, cue, real shot move or overlay), and runs of the same transition. Warnings only.
export function rhythmGate(timeline, config) {
  const g = { ...GATE_DEFAULTS, ...(config.gates ?? {}) };
  const out = [];
  const gaps = stillGaps(timeline, g.maxStill);
  for (const x of gaps.sort((a, b) => b.len - a.len).slice(0, 5)) {
    const sc = timeline.scenes.find((s) => s.id === x.from.scene);
    const line = gapLine(sc, x.from.t, x.to.t);
    // A scene with no shot track gets the auto one: the compiler then drifts through any still stretch.
    // Charts and cards are not pushed into (laidOut): their stretch wants a cue.
    const auto = !sc?.shots?.length && sc?.type !== "device" && !laidOut(sc?.type);
    const shot = auto ? `add "shots": "auto"` : "add a shot";
    // Chart elements with no cue whose numbers or dates are said in the stretch: pin them all on those words.
    const nums = !auto && numberReveals(sc);
    const said = nums && Object.entries(nums.cues).filter((_, i) => sc.start + nums.times[i] > x.from.t + 0.5 && sc.start + nums.times[i] < x.to.t - 0.5);
    // Otherwise a cue just after the stretch whose line starts in it moves to that line's opening.
    const early = !said?.length && sc && earlierCue(timeline, sc, x, g.maxStill);
    // Or a written shot in it that barely moves gets pushed further.
    const push = !said?.length && !early && sc && biggerShot(timeline, sc, x, g.maxStill);
    // A number's phrase ends on its digits or unit; a date's on 年/月/日/号; words (a note, an item, a bar's name) are listed.
    const kind = ([n, p]) => (nums.texts.includes(n) ? "text" : /[年月日号]$/.test(p) ? "dates" : "numbers");
    const what = ["numbers", "dates", "text"].filter((k) => (said || []).some((e) => kind(e) === k)).join(" and ");
    const reveal = said?.length ? `cue its ${what} on the words that say them (${said.map(([, p]) => `"${p}"`).join(", ")}), or ${shot} or an overlay` : null;
    const where = reveal ?? (early ? `move cue "${early.name}" to "${early.phrase}" (${early.t.toFixed(1)}s), where its line starts, or ${shot} or an overlay` : null)
      ?? (push ? `the shot at ${push.t.toFixed(1)}s barely moves — push it to zoom ${push.zoom} (from ${push.from}), or add a cue or overlay` : null) ?? (line ? `cue a reveal on "${line.phrase}" (${line.t.toFixed(1)}s), or ${shot} or an overlay` : auto ? `${shot}, or a cue or overlay` : "add a cue, shot or overlay");
    const fix = auto ? { scene: x.from.scene, path: ["shots"], value: "auto", add: true } : reveal ? { scene: x.from.scene, path: ["cues"], set: nums.cues, add: true, with: nums.refs } : early ? { scene: x.from.scene, path: ["cues", early.name], value: early.phrase }
      : push ? { scene: x.from.scene, path: ["shots", push.ks[0], "zoom"], value: push.zoom, add: true, with: push.ks.slice(1).map((k) => ({ path: ["shots", k, "zoom"], value: push.zoom })) } : null;
    out.push(issue("warn", "rhythm", `${x.len.toFixed(1)}s with nothing new on screen from ${x.from.t.toFixed(1)}s (scene "${x.from.scene}") — ${where} (max ${g.maxStill}s)`, { scene: x.from.scene, from: x.from.t, to: x.to.t, field: auto || push ? "shots" : reveal || early || line ? "cues" : undefined }, fix));
  }
  const types = timeline.scenes.slice(1).map((s) => s.transitionIn?.type);
  // Cuts between scenes on the same device are the device staying put, not a transition.
  const onDevice = (i) => timeline.scenes[i + 1].type === "device" && timeline.scenes[i].type === "device";
  let run = 1;
  for (let i = 1; i < types.length; i++) {
    run = types[i] === types[i - 1] && !onDevice(i) ? run + 1 : 1;
    if (run !== g.maxSameTransitionRun + 1) continue;
    // The scene ending the run enters differently: a chapter opens with a wipe, anything else cuts
    // (a small move within the topic); a run of cuts gets a short fade.
    const sc = timeline.scenes[i + 1];
    const to = types[i] === "cut" ? "fade" : sc.type === "chapter" ? "wipe" : "cut";
    out.push(issue("warn", "rhythm", `${run}+ consecutive "${types[i]}" transitions ending at "${sc.id}" — vary them at chapter turns (e.g. "enter": "${to}" on "${sc.id}")`, null, { scene: sc.id, path: ["enter"], value: to, add: true }));
  }
  // A scene that continues the world before it (inherit) joined by a transition that throws the
  // whole frame away and back: the same place jumps out and lands again, a glitch, not a cut.
  for (const [i, sc] of timeline.scenes.entries()) {
    const prev = timeline.scenes[i - 1];
    const type = sc.transitionIn?.type;
    if (!prev || !sameWorld(prev, sc) || !REFRAMING.has(type)) continue;
    const own = sc.enter ? { scene: sc.id, path: ["enter"] } : { scene: prev.id, path: ["exit"] };
    out.push(issue("warn", "rhythm", `"${prev.id}" → "${sc.id}" continues one world (inherit) but joins with "${type}": the frame leaves and lands back on the same place, which reads as a glitch — use fade or dip (or a cut when the new framing is clearly different)`, { scene: sc.id, from: sc.start - 0.5, to: sc.start + 0.5, field: own.path[0] }, { ...own, value: "fade" }));
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
      if (next - arrive < hold) out.push(issue("warn", "device", `scene "${sc.id}" step ${i} (${st.t}s): the result holds ${Math.max(0, next - arrive).toFixed(2)}s before ${steps[i + 1] ? `step ${i + 1}` : "the scene ends"} — give it ${hold}s+ (gates.deviceHold)`, { scene: sc.id, from: sc.start + st.t, to: sc.start + next, field: "props.steps" }));
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
