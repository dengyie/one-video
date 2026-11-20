// Shot track: a scene's camera as a list of framings. Between two shots the camera either cuts
// (jumps on the frame the shot starts) or travels in `ease` seconds; the frame is never allowed to
// show past the edge of the layer it films.
import type { Shot } from "./types";
import { clamp01, easeInOut, lerp } from "./motion";

export type View = { zoom: number; x: number; y: number; rotate: number };

export const WIDE: View = { zoom: 1, x: 0.5, y: 0.5, rotate: 0 };

// Keep a zoomed frame inside the 0–1 layer (zoom < 1 shows the edge by design, so no clamp).
export function clampView(v: View): View {
  if (v.zoom <= 1) return v;
  const half = 0.5 / v.zoom;
  return { ...v, x: Math.min(1 - half, Math.max(half, v.x)), y: Math.min(1 - half, Math.max(half, v.y)) };
}

export function viewAt(shots: Shot[] | undefined, t: number): View {
  if (!shots?.length) return WIDE;
  let v: View = { zoom: shots[0].zoom, x: shots[0].x, y: shots[0].y, rotate: shots[0].rotate };
  for (const s of shots) {
    if (t < s.t) break;
    const p = s.cut ? 1 : easeInOut(clamp01((t - s.t) / Math.max(0.01, s.ease)));
    v = { zoom: lerp(v.zoom, s.zoom, p), x: lerp(v.x, s.x, p), y: lerp(v.y, s.y, p), rotate: lerp(v.rotate, s.rotate, p) };
  }
  return clampView(v);
}

// The span of the layer (0–1 across) the shot track keeps on screen through the whole of [a, b]:
// the overlap of every framing in that window, so text fitted to it never leaves the frame there.
export function seenSpan(shots: Shot[] | undefined, a: number, b: number): [number, number] {
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

// Weaker copy of a view for a layer further away (the backdrop): it zooms and travels `k` as far.
export const farther = (v: View, k: number): View => clampView({ zoom: 1 + (v.zoom - 1) * k, x: 0.5 + (v.x - 0.5) * k, y: 0.5 + (v.y - 0.5) * k, rotate: v.rotate * k });

// CSS transform (origin at the layer centre) that films a w×h layer through view v.
export function viewTransform(v: View, w: number, h: number): string | undefined {
  if (v.zoom === 1 && v.x === 0.5 && v.y === 0.5 && v.rotate === 0) return undefined;
  return `scale(${v.zoom}) translate(${(0.5 - v.x) * w}px, ${(0.5 - v.y) * h}px)${v.rotate ? ` rotate(${v.rotate}deg)` : ""}`;
}

// Screen-space motion of the frame centre between two views, in px per frame, plus the radial
// spread a zoom change causes at the frame edge. Feeds the motion-blur filter.
export function viewVelocity(a: View, b: View, w: number, h: number): { vx: number; vy: number; radial: number } {
  return {
    vx: (b.x - a.x) * w * b.zoom,
    vy: (b.y - a.y) * h * b.zoom,
    radial: Math.abs(b.zoom - a.zoom) / Math.max(0.01, b.zoom) * Math.hypot(w, h) * 0.5,
  };
}

// A cut landing inside (a, b] is a jump, not motion: no blur on that frame.
export const cutBetween = (shots: Shot[] | undefined, a: number, b: number) => Boolean(shots?.some((s) => s.cut && s.t > a && s.t <= b));
