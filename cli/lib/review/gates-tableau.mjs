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

// Tableau grounding: a lighthouse, hut or figure set on a cliff's top (its foot at the cliff's
// height, at the cliff's depth) must stand on it. Past the cliff's edge the top gives way to the
// face, so the piece hangs over the sea — invisible in the opening wide, glaring once a later shot
// moves in (the keeper's hut floated beside the storm). Reported once per element, where it first
// shows, with the x that brings it back onto the rock.
const STANDING = ["lighthouse", "hut", "figure", "fire"];
const GROUND_Y = 0.035, GROUND_DEPTH = 0.1, EDGE = 0.005;

// Where the storyboard sets an element's x, so `onevideo fix` can move it: the latest scene up to
// `upTo` that defines it (an inherited element keeps the x it was given). Only a still piece set by
// a plain x — one placed on another (on) or keyframed in x is the author's to move.
function definedX(storyboard, upTo, id) {
  if (!storyboard?.scenes || id == null) return null;
  const end = storyboard.scenes.findIndex((s) => s.id === upTo);
  if (end < 0) return null;
  const same = storyboard.scenes.flatMap((s) => (s.props?.elements ?? []).filter((e) => e.id === id));
  if (same.some((e) => e.on != null || (e.to ?? []).some((k) => k.x != null))) return null;
  for (let k = end; k >= 0; k--) {
    const sc = storyboard.scenes[k];
    const j = (sc.props?.elements ?? []).findIndex((e) => e.id === id && e.type);
    if (j >= 0) return typeof sc.props.elements[j].x === "number" ? { scene: sc.id, path: ["props", "elements", j, "x"] } : null;
    if (sc.type !== "tableau" || !sc.props?.inherit) return null;
  }
  return null;
}

export function groundingGate(timeline, config = {}, storyboard = null) {
  const g = { ...FRAMING_DEFAULTS, ...(config.gates ?? {}) };
  const { width: W, height: H } = timeline;
  const out = [];
  const seen = new Set();
  for (const sc of timeline.scenes) {
    if (sc.type !== "tableau") continue;
    const els = sc.props?.elements ?? [];
    const cliffs = els.filter((e) => e.type === "cliff");
    if (!cliffs.length) continue;
    for (let t = 0; t < sc.duration; t += g.framingStep) {
      const horizon = horizonAt(els, t);
      const rocks = cliffs.map((c) => elementAt(c, t)).filter((c) => c.shown && (c.opacity ?? 1) > 0.5);
      for (const [i, el] of els.entries()) {
        const key = el.id ?? `${sc.id}#${i}`;
        if (!STANDING.includes(el.type) || seen.has(key)) continue;
        const s = elementAt(el, t);
        if (!s.shown || (s.opacity ?? 1) * s.enter < 0.5) continue;
        const geo = elementGeometry(s, { W, H, horizon });
        if (!geo) continue;
        const [bx, by] = geo.anchors.base ?? [(geo.box[0] + geo.box[2]) / 2, geo.box[3]];
        const rock = rocks.find((c) => Math.abs(by - c.y) <= GROUND_Y && Math.abs(geo.depth - (c.depth ?? 0)) <= GROUND_DEPTH);
        if (!rock) continue;
        const right = rock.side === "right";
        const off = right ? bx < rock.x - EDGE : bx > rock.x + EDGE;
        if (!off) continue;
        seen.add(key);
        const half = (geo.box[2] - geo.box[0]) / 2;
        const x = Math.round((right ? rock.x + half + EDGE : rock.x - half - EDGE) * 1000) / 1000;
        const named = el.id ? `"${el.id}"` : `#${i}`;
        out.push(issue("warn", "grounding", `scene "${sc.id}" ${el.type} ${named} stands past the cliff's edge (x ${r2(bx)}, the rock ends at ${r2(rock.x)}) and hangs over the sea: x ${x} puts it on the rock (or widen the cliff, or set its y to the shore if it belongs there)`, { scene: sc.id, from: sc.start + t, field: `props.elements[${i}]` }, fixAt(definedX(storyboard, sc.id, el.id), x)));
      }
    }
  }
  return out;
}

const fixAt = (spot, value) => (spot ? { ...spot, value } : undefined);
const r2 = (x) => Math.round(x * 100) / 100;
