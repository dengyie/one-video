// Tableau props that name other elements instead of coordinates, resolved once their times are:
// an element placed `on` another stands on one of its anchor points (the keeper on the lighthouse
// gallery), and a camera key `on` an element (or several) is solved through the parallax so that
// point lands where the key says — no hand-computed focus that drifts when a piece moves. On
// hills an element stands on a ridgeline at its own x and keeps to it as it moves (`follow`).
// In a frame narrower than the 16:9 stage (9:16…) the keys that give x/y by hand are reframed onto
// what they were showing, so the vertical cut follows the people, not the middle of the stage.
import { BODIES, KINDS, SOLID, boxOnScreen, cameraAt, cameraFor, insideShare, stageOf, elementAt, elementGeometry, horizonAt, ridgeDepth, ridgeTop, stateAt, zoomToFit } from "../../../shared/tableau.mjs";
import { r3 } from "./util.mjs";

export const DEFAULT_FILL = 0.5;
const MAX_AUTO_ZOOM = 3;

export function resolveTableauRefs(props, { width, height, duration = 0 }, errors, where) {
  const els = props.elements ?? [];
  const byId = new Map(els.filter((e) => e.id).map((e) => [e.id, e]));
  const names = () => els.filter((e) => BODIES.includes(e.type)).map((e) => e.id).join(", ") || "none";
  const resolving = new Set(), failed = new Set();
  const { kx } = stageOf(width, height);

  // An element on another one sits where that one is: resolve the target first (chains allowed).
  const place = (el, label) => {
    if (el.on === undefined) return true;
    if (failed.has(el)) return false;
    if (resolving.has(el)) { errors.push(`${where} ${label}: on "${el.on}" loops back to itself`); failed.add(el); return false; }
    resolving.add(el);
    const target = byId.get(el.on);
    const ok = target && target !== el && place(target, `element ${target.id}`);
    resolving.delete(el);
    if (!target || target === el) errors.push(`${where} ${label}: on "${el.on}" is not another element of this scene (solid ones: ${names()})`);
    if (target && target !== el && ok && target.type === "hills") return onRidge(el, target, label);
    const g = target && target !== el && ok ? geometry(target, el.t ?? 0, label) : null;
    const p = g && anchorPoint(g, el.anchor, target.id, label);
    if (!p) { failed.add(el); return false; }
    el.depth ??= g.depth;
    el.x = r3(p[0] + (el.dx ?? 0));
    el.y = r3(p[1] + (el.dy ?? 0));
    for (const k of ["on", "anchor", "dx", "dy"]) delete el[k];
    return true;
  };
  // Standing on hills: the ridgeline (`anchor` ridge = the nearest, ridge0… far to near) at the
  // element's own x; every keyframe that moves x gets the ridge's y there, and `follow` lets the
  // renderer keep the feet on the crest between keys.
  const onRidge = (el, hills, label) => {
    const s = elementAt(hills, el.t ?? 0), n = Math.max(1, Math.round(s.layers ?? 1));
    const m = /^ridge(\d*)$/.exec(el.anchor ?? "ridge"), k = m ? (m[1] === "" ? n - 1 : Number(m[1])) : -1;
    if (k < 0 || k >= n) { errors.push(`${where} ${label}: "${hills.id}" has no anchor "${el.anchor}" (ridge = the nearest ridgeline, ridge0…ridge${n - 1} far to near)`); failed.add(el); return false; }
    const dx = el.dx ?? 0, dy = el.dy ?? 0, at = (x) => r3(ridgeTop(s, k, x).y + dy);
    el.depth ??= ridgeDepth(s, k);
    el.x = r3((el.x ?? KINDS[el.type]?.x ?? 0.5) + dx);
    el.y = at(el.x);
    for (const key of el.to ?? []) if (typeof key.x === "number") { key.x = r3(key.x + dx); key.y ??= at(key.x); }
    el.follow = { id: hills.id, k, dy };
    for (const f of ["on", "anchor", "dx", "dy"]) delete el[f];
    return true;
  };
  const geometry = (el, t, label) => {
    const g = elementGeometry(stateAt(el, els, t), { W: width, H: height, horizon: horizonAt(els, t) });
    if (!g) errors.push(`${where} ${label}: "${el.id}" (${el.type}) has no body to aim at (${BODIES.join(", ")} do)`);
    return g;
  };
  const anchorPoint = (g, anchor, id, label) => {
    const p = g.anchors[anchor ?? "center"];
    if (!p) errors.push(`${where} ${label}: "${id}" has no anchor "${anchor}" (${Object.keys(g.anchors).join(", ")})`);
    return p;
  };

  for (const [i, el] of els.entries()) place(el, `element ${el.id ?? i}`);

  for (const [i, k] of (props.camera ?? []).entries()) {
    if (k.on === undefined) continue;
    const label = `camera ${i}`;
    const ids = Array.isArray(k.on) ? k.on : [k.on];
    if (k.x !== undefined || k.y !== undefined) { errors.push(`${where} ${label}: set either on or x/y, not both`); continue; }
    if (ids.length > 1 && k.anchor) { errors.push(`${where} ${label}: anchor names a point on one element; framing ${ids.join(", ")} uses their joint box`); continue; }
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) { errors.push(`${where} ${label}: on "${missing.join(", ")}" is not an element of this scene (solid ones: ${names()})`); continue; }
    const t = k.t ?? 0;
    const geos = ids.map((id) => geometry(byId.get(id), t, label));
    if (geos.some((g) => !g)) continue;
    const box = /** @type {[number, number, number, number]} */ ([0, 1, 2, 3].map((j) => (j < 2 ? Math.min : Math.max)(...geos.map((g) => g.box[j]))));
    const depth = geos.reduce((a, g) => a + g.depth, 0) / geos.length;
    const p = ids.length === 1 ? anchorPoint(geos[0], k.anchor, ids[0], label) : [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    if (!p) continue;
    const zoom = k.zoom ?? r3(Math.min(MAX_AUTO_ZOOM, zoomToFit(box, depth, k.fill ?? DEFAULT_FILL, kx)));
    const c = cameraFor(p, depth, zoom, k.place, kx);
    k.x = r3(c.x);
    k.y = r3(c.y);
    k.zoom = zoom;
    for (const f of ["on", "anchor", "place", "fill"]) delete k[f];
    k.aimed = ids;
  }
  if (kx > 1.01) reframe(props.camera ?? [], els, { W: width, H: height }, kx, duration);
  for (const k of props.camera ?? []) delete k.aimed;
}

// What a narrow frame should keep from a stage-wide shot, most telling first.
const SUBJECT = ["figure", "boat", "fire", "lighthouse", "hut", "town", "sun", "moon"];
const EDGE = 0.05;

// A key with hand-set x/y was composed for the whole stage. Where the camera comes to rest on it,
// take the bodies that shot shows (as the 16:9 frame sees them), most telling first, as many as fit
// the narrow window together, and slide the key sideways so they sit in it — until the next key
// takes over, so a walking figure stays in too. A key aimed with `on`
// keeps its target where it was put. Either way the slide avoids leaving another body half in the
// frame (it goes wholly in or wholly out); y and zoom stay.
function reframe(keys, els, frame, kx, duration) {
  const T = (k) => k.t ?? 0;
  const rest = keys.map((k, i) => (i + 1 < keys.length && !keys[i + 1].cut ? Math.min(T(keys[i + 1]), T(k) + (k.dur ?? 2)) : T(k) + (i === 0 || k.cut ? 0 : k.dur ?? 2)));
  // Bodies at t with the camera across at k's x (its y and zoom as the keys have them then — the next
  // key's x is still the 16:9 one); f: how far one unit of x slides each on screen (its layer's parallax).
  const bodiesAt = (k, t, aimed) => {
    const cam = { ...cameraAt(keys, t), x: k.x, sway: 0 };
    const out = [];
    for (const el of els) {
      const aimedAt = Array.isArray(aimed) && aimed.includes(el.id);
      if (!aimedAt && !SUBJECT.includes(el.type)) continue;
      const s = stateAt(el, els, t);
      if (!s.shown || (s.opacity ?? 1) < 0.5) continue;
      const g = elementGeometry(s, { ...frame, horizon: horizonAt(els, t) });
      if (!g) continue;
      const kd = 0.25 + 0.75 * Math.min(1, Math.max(0, g.depth));
      out.push({ id: el.id, g, aimedAt, wide: boxOnScreen(cam, g.depth, g.box), b: boxOnScreen(cam, g.depth, g.box, kx), f: kd * (1 + (cam.zoom - 1) * kd) * kx, rank: aimedAt ? -1 : SUBJECT.indexOf(el.type), solid: SOLID.includes(el.type) });
    }
    return out;
  };
  // The slides that keep a set inside [EDGE, 1 - EDGE].
  const span = (set) => [Math.max(...set.map((o) => (o.b[2] - 1 + EDGE) / o.f)), Math.min(...set.map((o) => (o.b[0] - EDGE) / o.f))];
  for (const [i, k] of keys.entries()) {
    if (k.x === undefined) continue;
    const t = rest[i];
    const bodies = bodiesAt(k, t, k.aimed);
    const keep = k.aimed ? bodies.filter((o) => o.aimedAt) : bodies.filter((o) => insideShare(o.wide) > 0.5).sort((a, b) => a.rank - b.rank);
    if (!keep.length) continue;
    const main = keep[0];
    // The kept set: the main subject, then each next one while they all fit the window together.
    const kept = [main];
    for (const o of keep.slice(1)) {
      const [lo, hi] = span([...kept, o]);
      if (k.aimed || lo <= hi) kept.push(o);
    }
    let [lo, hi] = span(kept);
    if (lo <= hi) {
      // From the rest until the next key is halfway there (this key still leads the camera), keep the longest run of the kept set that fits at every moment.
      const nx = keys[i + 1];
      const end = nx && !nx.cut ? Math.max(t, (T(nx) + rest[i + 1]) / 2) : nx ? Math.max(t, T(nx)) : Math.max(t, duration || t + 2);
      const ts = [];
      for (let n = 0; n <= 6; n++) ts.push(t + ((end - t) * n) / 6);
      const seen = ts.map((u) => bodiesAt(k, u, k.aimed));
      for (let L = kept.length; L >= 1; L--) {
        const ids = new Set(kept.slice(0, L).map((o) => o.id));
        let [l, h] = span(kept.slice(0, L));
        for (const set of seen) {
          const sub = set.filter((o) => ids.has(o.id));
          if (!sub.length) continue;
          const [a, b] = span(sub);
          if (Math.max(l, a) <= Math.min(h, b)) [l, h] = [Math.max(l, a), Math.min(h, b)];
          else if (L > 1) { l = Infinity; break; } // too many to hold: try one fewer (the main one alone skips such moments)
        }
        if (l <= h) { kept.length = L; [lo, hi] = [l, h]; break; }
      }
    } else {
      // Wider than the window (a whole town, or an aimed set that cannot fit): stay inside the main one.
      [lo, hi] = [main.b[0] / main.f, (main.b[2] - 1) / main.f];
      if (lo > hi) [lo, hi] = [hi, lo];
    }
    const a0 = Math.min(...kept.map((q) => q.b[0])), a1 = Math.max(...kept.map((q) => q.b[2]));
    const want = k.aimed ? 0 : ((a0 + a1) / 2 - 0.5) / main.f;
    const clampDx = (v) => Math.min(hi, Math.max(lo, v));
    const others = bodies.filter((o) => !kept.includes(o) && o.solid);
    const cuts = (dx) => others.filter((o) => { const l = o.b[0] - dx * o.f, r = o.b[2] - dx * o.f; return l < 1 && r > 0 && (l < 0 || r > 1); }).length;
    const tries = [want, ...others.flatMap((o) => [(o.b[2] + 0.01) / o.f, (o.b[0] - 1.01) / o.f, (o.b[0] - EDGE) / o.f, (o.b[2] - 1 + EDGE) / o.f])].map(clampDx);
    const dx = tries.reduce((p, v) => (cuts(v) < cuts(p) || (cuts(v) === cuts(p) && Math.abs(v - want) < Math.abs(p - want)) ? v : p), tries[0]);
    // Applied at once: the next key's move starts from where this one now rests.
    if (Math.abs(dx) > 1e-3) k.x = r3(k.x + dx);
  }
}
