// @ts-check
// Shot track: a scene's camera as a list of framings. Between two shots the camera either cuts
// (jumps on the frame the shot starts) or travels in `ease` seconds; the frame is never allowed to
// show past the edge of the layer it films. The renderer films with it (template engine/camera.ts)
// and the gates model the same framing (caption band, crops), so both read this one copy.
import { clamp01, easeInOut, lerp } from "./ease.mjs";

/** @typedef {{ zoom: number, x: number, y: number, rotate: number }} View */
/** @typedef {{ t: number, zoom?: number, x?: number, y?: number, rotate?: number, ease?: number, cut?: boolean }} ShotLike */

/** @type {View} */
export const WIDE = { zoom: 1, x: 0.5, y: 0.5, rotate: 0 };

/** Keep a zoomed frame inside the 0–1 layer (zoom < 1 shows the edge by design, so no clamp).
 * @param {View} v @returns {View} */
export function clampView(v) {
  if (v.zoom <= 1) return v;
  const half = 0.5 / v.zoom;
  return { ...v, x: Math.min(1 - half, Math.max(half, v.x)), y: Math.min(1 - half, Math.max(half, v.y)) };
}

/** @param {ShotLike} s @returns {View} */
const framing = (s) => ({ zoom: s.zoom ?? 1, x: s.x ?? 0.5, y: s.y ?? 0.5, rotate: s.rotate ?? 0 });

/** The framing at scene time t.
 * @param {ShotLike[] | undefined} shots @param {number} t @returns {View} */
export function viewAt(shots, t) {
  if (!shots?.length) return WIDE;
  let v = framing(shots[0]);
  for (const s of shots) {
    if (t < s.t) break;
    const p = s.cut ? 1 : easeInOut(clamp01((t - s.t) / Math.max(0.01, s.ease ?? 0.6)));
    const to = framing(s);
    v = { zoom: lerp(v.zoom, to.zoom, p), x: lerp(v.x, to.x, p), y: lerp(v.y, to.y, p), rotate: lerp(v.rotate, to.rotate, p) };
  }
  return clampView(v);
}

/** Whether the camera is travelling at t (the framing changes within the next `dt` seconds).
 * @param {ShotLike[] | undefined} shots @param {number} t @param {number} [dt] */
export function cameraMoving(shots, t, dt = 0.1) {
  if (!shots?.length) return false;
  const a = viewAt(shots, t), b = viewAt(shots, t + dt);
  return Math.abs(a.zoom - b.zoom) > 0.002 || Math.abs(a.x - b.x) > 0.001 || Math.abs(a.y - b.y) > 0.001;
}

/** The span of the layer (0–1 across) the shot track keeps on screen through the whole of [a, b]:
 * the overlap of every framing in that window, so text fitted to it never leaves the frame there.
 * @param {ShotLike[] | undefined} shots @param {number} a @param {number} b @returns {[number, number]} */
export function seenSpan(shots, a, b) {
  if (!shots?.length) return [0, 1];
  let l = 0, r = 1;
  for (let t = a; ; t = Math.min(b, t + 0.1)) {
    const v = viewAt(shots, t), half = 0.5 / Math.max(1, v.zoom);
    l = Math.max(l, v.x - half);
    r = Math.min(r, v.x + half);
    if (t >= b) break;
  }
  return [l, r];
}

/** Right-edge inset in layer pixels, including the shot's crop while the label is visible.
 * @param {ShotLike[] | undefined} shots @param {number} a @param {number} b
 * @param {number} width @param {number} margin */
export function rightShotInset(shots, a, b, width, margin) {
  const [, right] = seenSpan(shots, a, b);
  return (1 - right) * width + margin;
}

/** The part of the layer on screen through all of [a, b], as [x0, y0, x1, y1] fractions (a push-in crops its edges).
 * @param {ShotLike[] | undefined} shots @param {number} a @param {number} b @param {number} [step] @returns {[number, number, number, number]} */
export function seenBox(shots, a, b, step = 0.25) {
  /** @type {[number, number, number, number]} */
  const vis = [0, 0, 1, 1];
  for (let t = a; t < b; t += step) {
    const v = viewAt(shots, t), r = 0.5 / v.zoom;
    vis.splice(0, 4, Math.max(vis[0], v.x - r), Math.max(vis[1], v.y - r), Math.min(vis[2], v.x + r), Math.min(vis[3], v.y + r));
  }
  return vis;
}

/** Weaker copy of a view for a layer further away (the backdrop): it zooms and travels `k` as far.
 * @param {View} v @param {number} k @returns {View} */
export const farther = (v, k) => clampView({ zoom: 1 + (v.zoom - 1) * k, x: 0.5 + (v.x - 0.5) * k, y: 0.5 + (v.y - 0.5) * k, rotate: v.rotate * k });

/** CSS transform (origin at the layer centre) that films a w×h layer through view v.
 * @param {View} v @param {number} w @param {number} h @returns {string | undefined} */
export function viewTransform(v, w, h) {
  if (v.zoom === 1 && v.x === 0.5 && v.y === 0.5 && v.rotate === 0) return undefined;
  return `scale(${v.zoom}) translate(${(0.5 - v.x) * w}px, ${(0.5 - v.y) * h}px)${v.rotate ? ` rotate(${v.rotate}deg)` : ""}`;
}

/** Screen-space motion of the frame centre between two views, in px per frame, plus the radial
 * spread a zoom change causes at the frame edge. Feeds the motion-blur filter.
 * @param {View} a @param {View} b @param {number} w @param {number} h */
export function viewVelocity(a, b, w, h) {
  return {
    vx: (b.x - a.x) * w * b.zoom,
    vy: (b.y - a.y) * h * b.zoom,
    radial: Math.abs(b.zoom - a.zoom) / Math.max(0.01, b.zoom) * Math.hypot(w, h) * 0.5,
  };
}

/** A cut landing inside (a, b] is a jump, not motion: no blur on that frame.
 * @param {ShotLike[] | undefined} shots @param {number} a @param {number} b */
export const cutBetween = (shots, a, b) => Boolean(shots?.some((s) => s.cut && s.t > a && s.t <= b));

/** The caption band (screen) in the scene's own frame coordinates under the shot framing at t.
 * @param {ShotLike[] | undefined} shots @param {number} t @param {boolean} [portrait]
 * @param {{top:number, bottom:number, width:number, height:number}} [slot] @returns {[number, number, number, number]} */
export function captionBand(shots, t, portrait = false, slot) {
  const sh = viewAt(shots, t);
  /** @param {number} v @param {number} c */
  const back = (v, c) => c + (v - 0.5) / sh.zoom;
  const [y0, y1] = slot ? [slot.top / slot.height, 1 - slot.bottom / slot.height]
    : portrait ? [0.74, 0.86] : [0.84, 0.96];
  const [x0, x1] = slot ? [(1 - slot.width) / 2, (1 + slot.width) / 2] : [0.2, 0.8];
  return [back(x0, sh.x), back(y0, sh.y), back(x1, sh.x), back(y1, sh.y)];
}
