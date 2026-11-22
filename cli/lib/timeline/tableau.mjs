// Tableau props that name other elements instead of coordinates, resolved once their times are:
// an element placed `on` another stands on one of its anchor points (the keeper on the lighthouse
// gallery), and a camera key `on` an element (or several) is solved through the parallax so that
// point lands where the key says — no hand-computed focus that drifts when a piece moves.
import { SOLID, cameraFor, elementAt, elementGeometry, horizonAt, zoomToFit } from "../../../shared/tableau.mjs";
import { r3 } from "./util.mjs";

export const DEFAULT_FILL = 0.5;
const MAX_AUTO_ZOOM = 3;

export function resolveTableauRefs(props, { width, height }, errors, where) {
  const els = props.elements ?? [];
  const byId = new Map(els.filter((e) => e.id).map((e) => [e.id, e]));
  const names = () => els.filter((e) => SOLID.includes(e.type)).map((e) => e.id).join(", ") || "none";
  const resolving = new Set(), failed = new Set();

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
    const g = target && target !== el && ok ? geometry(target, el.t ?? 0, label) : null;
    const p = g && anchorPoint(g, el.anchor, target.id, label);
    if (!p) { failed.add(el); return false; }
    el.depth ??= g.depth;
    el.x = r3(p[0] + (el.dx ?? 0));
    el.y = r3(p[1] + (el.dy ?? 0));
    for (const k of ["on", "anchor", "dx", "dy"]) delete el[k];
    return true;
  };
  const geometry = (el, t, label) => {
    const g = elementGeometry(elementAt(el, t), { W: width, H: height, horizon: horizonAt(els, t) });
    if (!g) errors.push(`${where} ${label}: "${el.id}" (${el.type}) has no body to aim at (${SOLID.join(", ")} do)`);
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
    const zoom = k.zoom ?? r3(Math.min(MAX_AUTO_ZOOM, zoomToFit(box, depth, k.fill ?? DEFAULT_FILL)));
    const c = cameraFor(p, depth, zoom, k.place);
    k.x = r3(c.x);
    k.y = r3(c.y);
    k.zoom = zoom;
    for (const f of ["on", "anchor", "place", "fill"]) delete k[f];
  }
}
