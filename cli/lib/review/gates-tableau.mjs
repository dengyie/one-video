// Tableau framing, on the compiled timeline: wherever the camera comes to rest, a solid element
// (lighthouse, boat, figure…) it shows is either in the frame or out of it — one sliced by the
// edge reads as a framing mistake (the keeper's lighthouse lost its lamp at the top of a still).
// An element meant to bleed off the edge says so with `crop: true`; one that fills most of the frame
// (a close-up on the keeper at the gallery crops the tower) could not have fitted, so it is the set.
import { SOLID, boxOnScreen, cameraAt, cameraMoving, elementAt, elementGeometry, horizonAt, insideShare } from "../../../shared/tableau.mjs";
import { issue } from "./issue.mjs";

export const FRAMING_DEFAULTS = { framingStep: 0.25, framingCut: [0.15, 0.9], framingSet: 0.75 };

export function framingGate(timeline, config = {}) {
  const g = { ...FRAMING_DEFAULTS, ...(config.gates ?? {}) };
  const [lo, hi] = g.framingCut;
  const { width: W, height: H } = timeline;
  const out = [];
  for (const sc of timeline.scenes) {
    if (sc.type !== "tableau") continue;
    const els = sc.props?.elements ?? [];
    const keys = sc.props?.camera ?? [];
    // Per element: the first stretch of rest where it is cut, reported once.
    const cut = new Map();
    for (let t = 0; t < sc.duration; t += g.framingStep) {
      if (cameraMoving(keys, t)) continue;
      const cam = cameraAt(keys, t);
      const horizon = horizonAt(els, t);
      for (const [i, el] of els.entries()) {
        if (!SOLID.includes(el.type) || el.crop) continue;
        const s = elementAt(el, t);
        if (!s.shown || (s.opacity ?? 1) * s.enter < 0.5) continue;
        const geo = elementGeometry(s, { W, H, horizon });
        if (!geo) continue;
        const b = boxOnScreen(cam, geo.depth, geo.box);
        if (b[2] - b[0] > g.framingSet || b[3] - b[1] > g.framingSet) continue;
        const share = insideShare(b);
        const key = el.id ?? `${el.type}#${i}`;
        const run = cut.get(key);
        if (share > lo && share < hi) {
          if (!run) cut.set(key, { i, el, from: t, to: t, share });
          else if (!run.done) Object.assign(run, { to: t, share: Math.min(run.share, share) });
        } else if (run) run.done = true;
      }
    }
    for (const [key, r] of cut) {
      const named = r.el.id ? `"${r.el.id}"` : key;
      const fix = r.el.id ? `aim a camera key at it (on: "${r.el.id}") or pull back` : "give it an id and aim a camera key at it (on), or pull back";
      out.push(issue("warn", "framing", `scene "${sc.id}" ${r.el.type} ${named} is cut by the frame edge at rest (${Math.round(r.share * 100)}% inside, ${r.from.toFixed(1)}–${(r.to + g.framingStep).toFixed(1)}s): ${fix}; crop: true if the bleed is meant`, { scene: sc.id, from: sc.start + r.from, to: sc.start + Math.min(sc.duration, r.to + g.framingStep), field: `props.elements[${r.i}]` }));
    }
  }
  return out;
}
