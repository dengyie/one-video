// Where a scene's subject sits on its last frame, from the asset's depth map: the centroid of what
// stands out nearest. A "through" transition dives toward it instead of the frame centre.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeGrayPng } from "./qc.mjs";

// Source seconds played by scene time t under a speed ramp; mirrors rampTime() in Media.tsx.
export function rampTime(t, ramp, fps, blend = 0.3) {
  if (!ramp?.length) return t;
  const speedAt = (x) => {
    let v = 1;
    for (const k of ramp) {
      const at = k.t ?? 0;
      if (x < at) break;
      const p = Math.min(1, (x - at) / blend);
      v = v + (k.speed - v) * (p * p * (3 - 2 * p));
    }
    return v;
  };
  let s = 0;
  for (let i = 0, n = Math.round(t * fps); i < n; i++) s += speedAt((i + 0.5) / fps) / fps;
  return s;
}

// Depth relative to its row median: a floor or water plane (near at the bottom, even across the
// row) drops out and what stands up from it remains.
export function standout(px, w, h) {
  const d = new Uint8Array(px.length);
  for (let y = 0; y < h; y++) {
    const row = px.subarray(y * w, (y + 1) * w), mid = [...row].sort((a, b) => a - b)[w >> 1];
    for (let x = 0; x < w; x++) d[y * w + x] = Math.max(0, row[x] - mid);
  }
  return d;
}

// Centroid of the nearest `share` of standout pixels (near = white), weighted by how far past the
// cut each is; null when nothing stands out by `min`.
export function nearCentroid(px, w, h, share = 0.08, min = 24) {
  px = standout(px, w, h);
  const hist = new Array(256).fill(0);
  for (const v of px) hist[v]++;
  let top = 255;
  while (top > 0 && !hist[top]) top--;
  if (top < min) return null;
  let thr = 255;
  for (let n = 0; thr > 0 && n + hist[thr] <= px.length * share; thr--) n += hist[thr];
  let sx = 0, sy = 0, sw = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = px[y * w + x] - thr;
    if (v > 0) { sx += x * v; sy += y * v; sw += v; }
  }
  return sw ? { x: (sx / sw + 0.5) / w, y: (sy / sw + 0.5) / h } : null;
}

// A point of a cover-fitted aw×ah layer, in 0–1 coordinates of the fw×fh frame.
export function coverPoint(p, aw, ah, fw, fh) {
  const k = Math.max(fw / aw, fh / ah);
  return { x: (p.x * aw * k - (aw * k - fw) / 2) / fw, y: (p.y * ah * k - (ah * k - fh) / 2) / fh };
}

// The layer a scene's subject lives on: footage/parallax content, else its media backdrop.
function subjectLayer(scene, assets) {
  const fill = scene.type === "footage" || scene.type === "parallax";
  const id = fill ? scene.props?.asset : scene.backdrop?.asset;
  const a = id && assets[id];
  return a ? { a, fill, start: (fill ? scene.props.startFrom : scene.backdrop.startFrom) ?? 0 } : null;
}

// Source frame (1-based, of a video asset) shown at scene time t.
function sourceFrame(scene, layer, fps, t) {
  const s = layer.start + (scene.type === "footage" ? rampTime(t, scene.props.ramp, fps) : t);
  return Math.min(layer.a.frames ?? Infinity, Math.max(1, Math.floor(s * (layer.a.fps ?? 30)) + 1));
}

// Depth map of a compiled scene's subject layer at scene time t: { width, height, pixels, fill } or null.
export function depthAt(root, scene, assets, fps, t) {
  const layer = subjectLayer(scene, assets);
  if (!root || !layer?.a.depth) return null;
  let file = join(root, "public", layer.a.depth);
  if (layer.a.kind === "video") {
    const i = Math.min(layer.a.depthFrames ?? 1, Math.max(1, Math.floor((sourceFrame(scene, layer, fps, t) - 1) / (layer.a.depthStep ?? 2)) + 1));
    file = join(file, `${String(i).padStart(4, "0")}.png`);
  }
  if (!existsSync(file)) return null;
  return { ...decodeGrayPng(readFileSync(file)), fill: layer.fill };
}

// Luma grid (`onevideo depth` writes it beside the depth map) of the subject layer at scene time t:
// { w, h, px: 0–255 } or null.
export function lumaAt(root, scene, assets, fps, t) {
  const layer = subjectLayer(scene, assets);
  if (!root || !layer?.a.luma) return null;
  const file = join(root, "public", layer.a.luma);
  if (!existsSync(file)) return null;
  const g = (lumaCache[file] ??= JSON.parse(readFileSync(file, "utf8")));
  const i = layer.a.kind === "video" ? Math.min(g.frames.length - 1, Math.floor((sourceFrame(scene, layer, fps, t) - 1) / (g.step ?? 1))) : 0;
  return { w: g.w, h: g.h, px: Buffer.from(g.frames[i], "base64"), fill: layer.fill };
}
const lumaCache = {};

// Subject of a compiled scene at its end: { x, y, layer } with x/y in frame coordinates before the
// shot track ("content" for footage/parallax, "backdrop" for a scene's backdrop), or null.
export function subjectFocus(root, scene, assets, fps, fw, fh) {
  const d = depthAt(root, scene, assets, fps, scene.duration);
  const c = d && nearCentroid(d.pixels, d.width, d.height);
  if (!c) return null;
  // Pull 15% toward the centre and keep off the edges: the dive should still read as forward.
  const p = coverPoint(c, d.width, d.height, fw, fh);
  const keep = (v) => Math.round(Math.min(0.85, Math.max(0.15, 0.5 + (v - 0.5) * 0.85)) * 1000) / 1000;
  return { x: keep(p.x), y: keep(p.y), layer: d.fill ? "content" : "backdrop" };
}

// Mean of a w×h grid over the frame-space box [x0, y0, x1, y1] (0–1) of a cover-fitted layer.
export function boxMean(px, w, h, box, fw, fh, aw = w, ah = h) {
  const k = Math.max(fw / aw, fh / ah), ox = (aw * k - fw) / 2 / (aw * k), oy = (ah * k - fh) / 2 / (ah * k);
  const sx = fw / (aw * k), sy = fh / (ah * k);
  const gx = (v) => Math.min(w - 1, Math.max(0, Math.floor((ox + v * sx) * w)));
  const gy = (v) => Math.min(h - 1, Math.max(0, Math.floor((oy + v * sy) * h)));
  let sum = 0, n = 0;
  for (let y = gy(box[1]); y <= gy(box[3]); y++) for (let x = gx(box[0]); x <= gx(box[2]); x++) { sum += px[y * w + x]; n++; }
  return n ? sum / n : 0;
}

// Rough frame-space box of a word overlay: CJK glyphs ~1 em wide, Latin/digits ~0.6 em.
export function wordBox(o, fw, fh) {
  const u = Math.min(fw, fh) / 1080, size = (o.size ?? 150) * u;
  const ems = Array.from(o.text ?? "").reduce((n, c) => n + (/[\u2e80-\uffff]/.test(c) ? 1 : 0.6), 0);
  const hw = (ems * size) / 2 / fw, hh = (size * 0.55) / fh;
  const x = o.x ?? 0.5, y = o.y ?? 0.5;
  return [x - hw, y - hh, x + hw, y + hh];
}

// Share of a frame-space box covered by the subject (standout depth past `min`).
export function subjectShare(d, box, fw, fh, min = 24) {
  const m = Uint8Array.from(standout(d.pixels, d.width, d.height), (v) => (v >= min ? 255 : 0));
  return boxMean(m, d.width, d.height, box, fw, fh) / 255;
}

// Where a word overlay without an authored x should sit so it doesn't cover the subject: the
// first of centre / left / right whose box is clear, else the one covering least. null = keep.
export function dodgeX(d, o, fw, fh, clear = 0.12) {
  let best = null;
  for (const x of [0.5, 0.3, 0.7]) {
    const share = subjectShare(d, wordBox({ ...o, x }, fw, fh), fw, fh);
    if (share <= clear) return x === 0.5 ? null : x;
    if (!best || share < best.share - 0.05) best = { x, share };
  }
  return best.x === 0.5 ? null : best.x;
}

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
// WCAG relative luminance of #rrggbb, and of a 0–255 luma value.
export const hexLuminance = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
export const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// How strong a scrim text of luminance `text` needs over a background of mean luma `bg` (0–255):
// 0 at 4.5:1 or better, 1 at 1.5:1 or worse.
export function scrimFor(text, bg) {
  const r = contrast(text, lin(bg));
  return Math.round(Math.min(1, Math.max(0, (4.5 - r) / 3)) * 100) / 100;
}
