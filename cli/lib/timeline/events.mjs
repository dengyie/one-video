// What a viewer sees change on screen: every reveal of a compiled timeline in timeline seconds
// (the rhythm gate and look's note checks read it; the compiler fills long still stretches from it).
import { weakMove } from "./shots.mjs";
import { linePointTimes, lineSegmentStart } from "../../../shared/line-reveal.mjs";

// Longest stretch with nothing new on screen before it reads as a stall (gates.maxStill).
export const MAX_STILL = 4.5;
// Overlays that accent something already there rather than show something of their own.
export const OVERLAY_EFFECTS = new Set(["burst", "confetti", "spotlight", "flash", "mark"]);

// Reveal times the compiler resolved into props (`t` of items, morphs, path stops, cards…).
export function propTimes(v, at) {
  if (Array.isArray(v)) for (const x of v) propTimes(x, at);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) k === "t" && typeof x === "number" ? at(x) : propTimes(x, at);
}

// When a bar race moves to each period (scene seconds), as BarRaceScene's periodTimes
// (template/src/scenes/Data.tsx): cued periods are anchors, the rest spread evenly between them,
// the last arriving at 72% of the scene unless cued. The swap into period k starts at T[k].
export function periodTimes(n, duration, cueAt) {
  const endAt = Math.max(1.6, Math.min(duration * 0.72, duration - 1.5));
  const T = Array.from({ length: n }, (_, k) => cueAt(k));
  T[0] = T[0] ?? 0.6;
  T[n - 1] = T[n - 1] ?? Math.max(endAt, T[0] + 1);
  let a = 0;
  for (let k = 1; k < n; k++) {
    if (T[k] === undefined) continue;
    for (let j = a + 1; j < k; j++) T[j] = T[a] + ((T[k] - T[a]) * (j - a)) / (k - a);
    a = k;
  }
  for (let k = 1; k < n; k++) T[k] = Math.max(T[k], T[k - 1] + 0.5);
  return T;
}

// A bar race scene's period times from its compiled cues.
export const racePeriods = (sc) => periodTimes(sc.props?.periods?.length ?? 0, sc.duration, (k) => {
  const t = sc.cues?.[sc.props?.periodCues?.[k]];
  return Number.isFinite(t) ? t : undefined;
});

// Every string a scene's props, overlays or shots carry: a cue no element names (a compare side
// with no `cue`, a name left over from an edit) changes nothing on screen.
export function named(v, out = new Set()) {
  if (typeof v === "string") out.add(v);
  else if (Array.isArray(v)) for (const x of v) named(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) named(x, out);
  return out;
}

// Every moment something new appears on screen, in timeline seconds: scene starts, cue reveals,
// shots, overlay entrances and timed props. A shot that barely moves the frame (no cut, zoom and
// position within a few percent of the shot before) is marked `weak`.
export function screenEvents(timeline) {
  const events = [];
  for (const sc of timeline?.scenes ?? []) {
    const at = (t, what, weak = false) => { if (t >= 0 && t <= sc.duration) events.push({ t: sc.start + t, scene: sc.id, what, ...(weak && { weak }) }); };
    at(0, "scene");
    const used = named([sc.props, sc.overlays, sc.shots]);
    for (const [name, t] of Object.entries(sc.cues ?? {})) if (used.has(name)) at(t, "cue");
    let prev = null;
    for (const sh of sc.shots ?? []) {
      const weak = weakMove(prev, sh);
      at(sh.t, "shot", weak);
      prev = sh;
    }
    for (const o of sc.overlays ?? []) at(o.t, "overlay");
    propTimes(sc.props, (t) => at(t, "prop"));
    // A quote read aloud lights up line by line as it is spoken (its caption is dropped for that).
    if (sc.type === "quote" && sc.captions === false) for (const l of sc.lines ?? []) at(l.start, "prop");
    // A cued line chart sets off toward each point well before it lands (same travel as LineChartScene).
    // A bar race opens with its bars rising (the leader lands last, as BarRaceScene's grow) and
    // re-ranks at the start of each swap.
    if (sc.type === "bar-race" && sc.props?.periods?.length >= 2) {
      at(0.15 + (Math.min(sc.props.top ?? 10, sc.props.series?.length ?? 0) - 1) * 0.15 + 0.7, "prop");
      racePeriods(sc).slice(1).forEach((t) => at(t, "prop"));
    }
    if (sc.type === "line-chart" && Array.isArray(sc.props?.pointCues)) {
      const n = Math.max(sc.props.pointCues.length, ...(sc.props.series ?? []).map((s) => s.points.length));
      const T = linePointTimes(sc, n, sc.props.pointCues, sc.cues?.[sc.props.drawCue] ?? 0.5) ?? [];
      for (let k = 1; k < T.length; k++) at(lineSegmentStart(T[k - 1], T[k]), "prop");
    }
  }
  return events.sort((a, b) => a.t - b.t);
}
