// What a viewer sees change on screen: every reveal of a compiled timeline in timeline seconds
// (the rhythm gate and look's note checks read it; the compiler fills long still stretches from it).
import { weakMove } from "./shots.mjs";

// Longest stretch with nothing new on screen before it reads as a stall (gates.maxStill).
export const MAX_STILL = 4.5;
// Overlays that accent something already there rather than show something of their own.
export const OVERLAY_EFFECTS = new Set(["burst", "confetti", "spotlight", "flash", "mark"]);

// Reveal times the compiler resolved into props (`t` of items, morphs, path stops, cards…).
export function propTimes(v, at) {
  if (Array.isArray(v)) for (const x of v) propTimes(x, at);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) k === "t" && typeof x === "number" ? at(x) : propTimes(x, at);
}

// Every moment something new appears on screen, in timeline seconds: scene starts, cue reveals,
// shots, overlay entrances and timed props. A shot that barely moves the frame (no cut, zoom and
// position within a few percent of the shot before) is marked `weak`.
export function screenEvents(timeline) {
  const events = [];
  for (const sc of timeline?.scenes ?? []) {
    const at = (t, what, weak = false) => { if (t >= 0 && t <= sc.duration) events.push({ t: sc.start + t, scene: sc.id, what, ...(weak && { weak }) }); };
    at(0, "scene");
    for (const t of Object.values(sc.cues ?? {})) at(t, "cue");
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
    if (sc.type === "line-chart" && Array.isArray(sc.props?.pointCues)) {
      const T = sc.props.pointCues.map((c) => sc.cues?.[c]);
      for (let k = 1; k < T.length; k++) if (Number.isFinite(T[k]) && Number.isFinite(T[k - 1])) at(T[k] - Math.min(3, Math.max(0.3, (T[k] - T[k - 1]) * 0.8)), "prop");
    }
  }
  return events.sort((a, b) => a.t - b.t);
}
