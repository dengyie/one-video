// The Map scene as the layout gate sees it: pins, pin labels, country labels and route labels at
// scene time t, as frame-fraction boxes. Camera path (mapViewAt), reveal times (revealAt), label
// placement (placePinLabels / clearOf / inFrame) and visibility rules are the renderer's own
// (shared/), so a warning here is a stack the render really draws. Only the projection is redone
// without d3: mercator and orthographic by formula, country labels on a precomputed geoCentroid.
import { countryCentroid } from "../library/geo.mjs";
import { seenSpan } from "../../../shared/camera.mjs";
import { easeOut } from "../../../shared/ease.mjs";
import { clearOf, inFrame, labelWidth, LABEL_H, mapViewAt, placePinLabels, visibleOnGlobe } from "../../../shared/labels.mjs";
import { cueOr, revealAt } from "../../../shared/reveal.mjs";

const RAD = Math.PI / 180;
const PIN_R = 14; // pin dot plus its stroke, u

// Great-circle midpoint of a route (geoInterpolate(from, to)(0.5)).
function midpoint(from, to) {
  const vec = ([lon, lat]) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
  const [a, b] = [vec(from), vec(to)], m = a.map((v, k) => v + b[k]);
  return [Math.atan2(m[1], m[0]) / RAD, Math.atan2(m[2], Math.hypot(m[0], m[1])) / RAD];
}

// The Map scene's projection at camera { center, zoom } with the globe turned to longitude lon0:
// geoMercator centred on the view latitude (frame centre 0.54 down in landscape), or geoOrthographic.
function projection({ globe, portrait, width, height, center, zoom, lon0 }) {
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * RAD) / 2));
  const s = (globe ? Math.min(width, height) * 0.42 : width / (2 * Math.PI)) * zoom;
  return ([lon, lat]) => {
    let dl = (lon - lon0) % 360;
    if (dl > 180) dl -= 360;
    if (dl < -180) dl += 360;
    if (!globe) return [width / 2 + s * dl * RAD, height * (portrait ? 0.5 : 0.54) - s * (merc(lat) - merc(center[1]))];
    const [f, f0, l] = [lat * RAD, center[1] * RAD, dl * RAD];
    return [width / 2 + s * Math.cos(f) * Math.sin(l), height / 2 - s * (Math.cos(f0) * Math.sin(f) - Math.sin(f0) * Math.cos(f) * Math.cos(l))];
  };
}

export function mapBoxes(sc, t, width, height, pace = 1) {
  const p = sc.props ?? {};
  const pins = p.pins ?? [], routes = p.routes ?? [], highlight = p.highlight ?? [];
  if (!pins.length && !routes.some((x) => x.label) && !highlight.some((h) => h.label)) return [];
  const globe = p.mode === "globe";
  const portrait = height >= width * 1.5;
  const u = Math.min(width, height) / 1080;
  const at = (i, n, cue) => revealAt(sc, pace, i, n, cue);
  const vs = p.views?.length ? p.views : [{ center: globe ? [105, 25] : [20, 20], zoom: 1 }];
  const fly = p.fly ?? 1.6;
  const starts = vs.map((v, i) => (i === 0 ? 0 : v.cue ? cueOr(sc, v.cue, 0) : v.at ?? at(i, vs.length)));
  const view = mapViewAt(vs, starts, t, fly);
  const lon0 = view.center[0] + (p.spin ?? 0) * t;
  const proj = projection({ globe, portrait, width, height, center: view.center, zoom: view.zoom, lon0 });
  const near = (ll) => !globe || visibleOnGlobe(ll, [lon0, view.center[1]]);
  const span = seenSpan(sc.shots, t, t).map((f) => f * width);
  const placed = [], out = [];

  // Pins (on screen once revealed) and their labels (from 0.15s after), placed as the scene does.
  const pinAt = pins.map((pn, i) => {
    if (!near([pn.lon, pn.lat])) return null;
    const s = at(i, pins.length, pn.cue);
    const [x, y] = proj([pn.lon, pn.lat]);
    if (t > s) out.push({ what: "pin", box: [x - PIN_R * u, y - PIN_R * u, x + PIN_R * u, y + PIN_R * u] });
    return { i, x, y, text: pn.label, o: easeOut((t - s - 0.15) / 0.4) };
  });
  for (const l of placePinLabels(pinAt.map((q) => (q && q.text ? q : null)), u, span, placed)) out.push({ what: `label "${l.text}"`, box: l.box });

  // Country labels centre on the country (0.3s after it lights up); one that would hide a visible
  // pin drops below it; both step down clear of the labels already placed.
  const detail = p.detail && p.detail !== "auto" ? p.detail : view.zoom > 2.2 ? "50m" : "110m";
  for (const [i, h] of highlight.entries()) {
    if (!h.label) continue;
    const c = countryCentroid(h.id, detail);
    if (!c || !near(c)) continue;
    const xy = proj(c);
    const o = easeOut((t - at(i, highlight.length, h.cue) - 0.3) / 0.5);
    const w = labelWidth(h.label) * u, lh = LABEL_H * u;
    const under = pinAt.find((q) => q && q.o > 0 && Math.abs(q.x - xy[0]) < w / 2 + PIN_R * u && Math.abs(q.y - xy[1]) < lh / 2 + PIN_R * u);
    const [x, y] = clearOf(placed, inFrame(under ? under.x : xy[0], w, span, u), under ? under.y + 22 * u + lh / 2 : xy[1], w, lh, 1, u, o);
    if (o > 0) out.push({ what: `label "${h.label}"`, box: [x - w / 2, y - lh / 2, x + w / 2, y + lh / 2] });
  }

  // Route labels 40u above the great-circle midpoint once the line is mostly drawn, stepping up.
  for (const [i, rt] of routes.entries()) {
    if (!rt.label) continue;
    const o = easeOut((t - at(i, routes.length, rt.cue) - (rt.duration ?? 1.4) * 0.6) / 0.4);
    const mid = proj(midpoint(rt.from, rt.to));
    const w = labelWidth(rt.label) * u, lh = LABEL_H * u;
    const [x, y] = clearOf(placed, inFrame(mid[0], w, span, u), mid[1] - 40 * u, w, lh, -1, u, o);
    if (o > 0) out.push({ what: `label "${rt.label}"`, box: [x - w / 2, y - lh / 2, x + w / 2, y + lh / 2] });
  }
  return out.map((m) => ({ ...m, box: [m.box[0] / width, m.box[1] / height, m.box[2] / width, m.box[3] / height] }));
}
