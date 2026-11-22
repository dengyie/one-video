// @ts-check
// Tableau: an illustrated, code-drawn place (sky, sea, a lighthouse, a boat…) whose pieces change
// over time and a camera that moves through layers at their own depth. The renderer
// (template/src/scenes/Tableau.tsx) draws it; the compiler resolves the times and carries a world
// over between scenes (`inherit`). Everything here is pure: element state at t, sky palettes, the
// sea surface, the camera and its parallax, lightning, deterministic noise.
import { clamp01, easeInOut, lerp } from "./ease.mjs";

/** @typedef {"night"|"storm"|"dusk"|"dawn"|"day"} Tone */
/** @typedef {{ top: string, mid: string, horizon: string, haze: string, seaFar: string, seaNear: string, land: string, rim: string, cloud: string, stars: number, glow: string }} Palette */

/** @type {Record<Tone, Palette>} */
export const PALETTES = {
  night: { top: "#060b18", mid: "#10203b", horizon: "#2a4466", haze: "#3a5476", seaFar: "#1b2d47", seaNear: "#050b16", land: "#03060c", rim: "#a9c0e0", cloud: "#1a2742", stars: 1, glow: "#ffc76a" },
  storm: { top: "#07090d", mid: "#151b22", horizon: "#2e3a44", haze: "#3c4952", seaFar: "#1a242b", seaNear: "#04070a", land: "#020304", rim: "#7f909c", cloud: "#11161c", stars: 0, glow: "#ffbf5e" },
  dusk: { top: "#1b1735", mid: "#673b5c", horizon: "#e48b58", haze: "#c9786a", seaFar: "#583c57", seaNear: "#140d1f", land: "#0d0914", rim: "#f6b98c", cloud: "#4b2c48", stars: 0.35, glow: "#ffc46a" },
  dawn: { top: "#1f345d", mid: "#8a7aa2", horizon: "#f7c58c", haze: "#e9b39a", seaFar: "#6a7593", seaNear: "#1a2037", land: "#111528", rim: "#ffdcaa", cloud: "#9a86a6", stars: 0.08, glow: "#ffd28a" },
  day: { top: "#3a78b6", mid: "#86b4db", horizon: "#d8ebf4", haze: "#cfe3ee", seaFar: "#4d86ab", seaNear: "#1b4a6b", land: "#1a2834", rim: "#ffffff", cloud: "#eef4f8", stars: 0, glow: "#fff2c4" },
};
export const TONES = /** @type {Tone[]} */ (Object.keys(PALETTES));

/** @param {string} c */
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
/** @param {string} a @param {string} b @param {number} p */
export function mixHex(a, b, p) {
  const x = rgb(a), y = rgb(b);
  return "#" + x.map((v, i) => Math.round(lerp(v, y[i], clamp01(p))).toString(16).padStart(2, "0")).join("");
}
/** @param {Palette} a @param {Palette} b @param {number} p @returns {Palette} */
export function mixPalette(a, b, p) {
  /** @type {any} */
  const out = {};
  for (const k of Object.keys(a)) {
    const va = /** @type {any} */ (a)[k], vb = /** @type {any} */ (b)[k];
    out[k] = typeof va === "number" ? lerp(va, vb, clamp01(p)) : mixHex(va, vb, p);
  }
  return out;
}

// What each piece is, where it sits in depth (0 = the sky at infinity, 1 = the nearest layer) and
// what it looks like when the storyboard says nothing more. Positions are frame fractions; sizes
// are fractions of the frame's short edge, heights (`h`) of the frame height.
/** @type {Record<string, Record<string, any>>} */
export const KINDS = {
  sky: { depth: 0, tone: "night" },
  stars: { depth: 0, density: 1, opacity: 1 },
  moon: { depth: 0.04, x: 0.78, y: 0.2, r: 0.05, opacity: 1 },
  sun: { depth: 0.04, x: 0.5, y: 0.66, r: 0.07, opacity: 1 },
  clouds: { depth: 0.18, y: 0.24, cover: 0.5, speed: 0.012, opacity: 1, seed: 3 },
  sea: { depth: 0.3, y: 0.66, swell: 0.3, opacity: 1, reflect: 1 },
  cliff: { depth: 0.62, side: "left", x: 0.24, y: 0.6, opacity: 1, seed: 7 },
  lighthouse: { depth: 0.62, x: 0.2, y: 0.6, h: 0.36, lit: 1, beam: 1, sweep: 40, opacity: 1 },
  hut: { depth: 0.62, x: 0.32, y: 0.6, size: 0.09, window: 1, opacity: 1 },
  boat: { depth: 0.82, x: 0.62, size: 0.13, rock: 1, lantern: 1, opacity: 1, facing: 1 },
  shore: { depth: 0.94, y: 0.86, opacity: 1 },
  figure: { depth: 0.96, x: 0.4, y: 0.86, size: 0.22, lantern: 0, opacity: 1, facing: 1 },
  fire: { depth: 0.96, x: 0.5, y: 0.86, r: 0.06, intensity: 1, opacity: 1 },
  rain: { depth: 1, intensity: 0, wind: 0.25, opacity: 1 },
  lightning: { depth: 0.12, x: 0.66, opacity: 1 },
  title: { depth: 1, x: 0.5, y: 0.42, size: 0.11, opacity: 1, text: "" },
  // Land worlds: ridgelines fading into the haze, a row of pines, a town whose windows light up,
  // drifting fog, a flock of birds, falling snow.
  hills: { depth: 0.22, y: 0.66, h: 0.2, rough: 0.3, layers: 3, cap: 0, opacity: 1, seed: 5 },
  fog: { depth: 0.5, y: 0.7, h: 0.1, cover: 0.6, speed: 0.01, opacity: 1, seed: 6 },
  town: { depth: 0.5, x: 0.5, y: 0.66, spread: 0.6, size: 0.12, count: 12, lit: 0.6, opacity: 1, seed: 2 },
  trees: { depth: 0.72, x: 0.5, y: 0.8, spread: 0.6, size: 0.14, count: 9, wind: 0.2, opacity: 1, seed: 4 },
  birds: { depth: 0.3, x: 0.3, y: 0.3, size: 0.025, count: 5, speed: 0.03, facing: 1, opacity: 1, seed: 8 },
  snow: { depth: 1, intensity: 0, wind: 0.1, opacity: 1 },
};
export const KIND_NAMES = Object.keys(KINDS);

/** Keys that blend when a keyframe changes them (the rest switch at the keyframe). */
const NUMERIC = ["x", "y", "r", "h", "size", "opacity", "cover", "speed", "swell", "lit", "beam", "sweep", "window", "rock", "lantern", "intensity", "wind", "density", "reflect", "depth", "spread", "rough", "cap", "count"];

/**
 * An element's state at t: kind defaults, its own fields, then each due keyframe (`to`) blended in
 * over its `dur`. `tone` (the sky) cross-fades palettes; `enter` is how far its entrance is
 * (an element timed later than 0 fades in over `fade` seconds).
 * @param {any} el @param {number} t
 */
export function elementAt(el, t) {
  const kind = KINDS[el.type] ?? {};
  /** @type {any} */
  let s = { ...kind, ...strip(el) };
  /** @type {Palette} */
  let palette = PALETTES[/** @type {Tone} */ (s.tone)] ?? PALETTES.night;
  for (const k of el.to ?? []) {
    const kt = k.t ?? 0;
    if (t < kt) break;
    const p = easeInOut(clamp01((t - kt) / Math.max(0.01, k.dur ?? 1)));
    /** @type {any} */
    const target = { ...s, ...strip(k) };
    /** @type {any} */
    const next = { ...target };
    for (const key of NUMERIC) if (typeof s[key] === "number" && typeof target[key] === "number") next[key] = lerp(s[key], target[key], p);
    if (k.tone && PALETTES[/** @type {Tone} */ (k.tone)]) palette = mixPalette(palette, PALETTES[/** @type {Tone} */ (k.tone)], p);
    s = next;
  }
  const start = el.t ?? 0;
  const enter = el.settled || start <= 0 ? 1 : easeInOut(clamp01((t - start) / (el.fade ?? 0.8)));
  return { ...s, palette, enter, shown: t >= start || el.settled === true };
}
/**
 * elementAt within its scene: a piece the compiler set on a ridgeline (`follow` {id, k, dy})
 * keeps its feet on that crest wherever its x has got to.
 * @param {any} el @param {any[]} elements @param {number} t
 */
export function stateAt(el, elements, t) {
  const s = elementAt(el, t), f = s.follow;
  const hills = f && elements.find((e) => e.id === f.id && e.type === "hills");
  return hills ? { ...s, y: ridgeTop(elementAt(hills, t), f.k, s.x).y + (f.dy ?? 0) } : s;
}
/** @param {any} o */
function strip(o) {
  const { to: _to, at: _at, cue: _cue, t: _t, dur: _dur, fade: _fade, settled: _s, strikes: _k, ...rest } = o;
  return rest;
}

/** The element in its final state, as a scene that inherits the world starts with it. @param {any} el */
export function settledElement(el) {
  const { to = [], at: _a, cue: _c, t: _t, ...rest } = el;
  /** @type {any} */
  const out = { ...rest };
  for (const k of to) { const { at: _ka, cue: _kc, t: _kt, dur: _kd, ...state } = k; Object.assign(out, state); }
  delete out.to;
  delete out.strikes;
  return { ...out, t: 0, settled: true };
}

/** The scene's sky palette: the first sky element's at t, night when there is none. @param {any[]} elements @param {number} t */
export function paletteAt(elements, t) {
  const sky = elements.find((e) => e.type === "sky");
  return sky ? elementAt(sky, t).palette : PALETTES.night;
}

// Camera: keyframes of a focus point (frame fractions) and zoom, flown in `dur` seconds with an
// ease, or cut to. `sway` (0..1) adds a slow handheld drift, for a storm.
/** @typedef {{ x: number, y: number, zoom: number, sway: number }} Cam */
/** @param {any[]} keys @param {number} t @returns {Cam} */
export function cameraAt(keys, t) {
  /** @type {Cam} */
  let cam = { x: 0.5, y: 0.5, zoom: 1, sway: 0 };
  for (const [i, k] of (keys ?? []).entries()) {
    const kt = k.t ?? 0;
    if (t < kt && i > 0) break;
    const to = { x: k.x ?? cam.x, y: k.y ?? cam.y, zoom: k.zoom ?? cam.zoom, sway: k.sway ?? cam.sway };
    if (i === 0 || k.cut) { cam = to; continue; }
    const p = easeInOut(clamp01((t - kt) / Math.max(0.05, k.dur ?? 2)));
    cam = { x: lerp(cam.x, to.x, p), y: lerp(cam.y, to.y, p), zoom: Math.exp(lerp(Math.log(cam.zoom), Math.log(to.zoom), p)), sway: lerp(cam.sway, to.sway, p) };
  }
  if (cam.sway > 0) {
    cam = { ...cam, x: cam.x + cam.sway * 0.006 * Math.sin(t * 0.9) + cam.sway * 0.003 * Math.sin(t * 2.3 + 1), y: cam.y + cam.sway * 0.005 * Math.sin(t * 1.3 + 2) };
  }
  return cam;
}

// How a layer at `depth` sees the camera: the sky barely moves (a quarter of the travel), the
// nearest layer moves with it fully. Returns the frame-fraction point the layer is centred on and
// its scale; a point p of the layer lands at (p - c) * scale + 0.5.
/** @param {Cam} cam @param {number} depth */
export function layerView(cam, depth) {
  const k = 0.25 + 0.75 * clamp01(depth);
  return { cx: 0.5 + (cam.x - 0.5) * k, cy: 0.5 + (cam.y - 0.5) * k, scale: 1 + (cam.zoom - 1) * k };
}
/** Whether the camera is travelling at t (text it carries past the edge is not a layout fault). @param {any[]} keys @param {number} t */
export function cameraMoving(keys, t) {
  const a = cameraAt(keys, t), b = cameraAt(keys, t + 0.1);
  return Math.abs(a.zoom - b.zoom) > 0.002 * a.zoom || Math.hypot(a.x - b.x, a.y - b.y) > 0.0008;
}

// Deterministic noise: a hash in [0, 1) per integer pair, and smooth 1-D value noise.
/** @param {number} a @param {number} [b] */
export function hash(a, b = 0) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
/** @param {number} x @param {number} [seed] */
export function noise(x, seed = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash(i, seed), hash(i + 1, seed), u);
}

// The sea: bands from the horizon (far, small slow swells) to the bottom edge (near, tall ones).
// waveY is a band's surface height at frame x and time t, in frame fractions; swell 0 is glass.
export const SEA_BANDS = 5;
/** @param {number} i @param {number} horizon */
export function bandBase(i, horizon) {
  const f = (i + 1) / SEA_BANDS;
  return horizon + (1.02 - horizon) * Math.pow(f, 1.6) * 0.92 - 0.004;
}
/** @param {number} i */
export const bandDepth = (i) => 0.3 + (0.7 * (i + 1)) / SEA_BANDS;
/** @param {number} i @param {number} x @param {number} t @param {number} swell @param {number} horizon */
export function waveY(i, x, t, swell, horizon) {
  const near = (i + 1) / SEA_BANDS;
  const amp = (0.0025 + 0.028 * near * near) * (0.25 + 1.75 * swell);
  const f = 5 + 9 * (1 - near), sp = 0.5 + 1.2 * swell;
  const w = Math.sin(x * f * 2.1 + t * sp * 1.3 + i * 1.7) * 0.55 + Math.sin(x * f * 3.7 - t * sp * 0.9 + i * 0.6) * 0.3 + Math.sin(x * f * 7.3 + t * sp * 2.1 + i) * 0.15 * (0.4 + swell);
  return bandBase(i, horizon) + amp * w;
}
/** Which band a floating thing at `depth` rides: the nearest band not in front of it. @param {number} depth */
export function bandFor(depth) {
  let best = 0;
  for (let i = 0; i < SEA_BANDS; i++) if (bandDepth(i) <= depth + 1e-6) best = i;
  return best;
}

// Lightning: how bright a strike is `dt` seconds after it, a double flicker that dies in ~0.6s.
/** @param {number} dt */
export function flashAt(dt) {
  if (dt < 0 || dt > 0.7) return 0;
  const a = Math.exp(-dt * 14), b = dt > 0.12 ? 0.75 * Math.exp(-(dt - 0.12) * 9) : 0;
  return clamp01(Math.max(a, b));
}
/** The brightest strike of every lightning element at t. @param {any[]} elements @param {number} t */
export function flashTotal(elements, t) {
  let f = 0;
  for (const e of elements) if (e.type === "lightning") for (const s of e.strikes ?? []) f = Math.max(f, flashAt(t - (s.t ?? 0)));
  return f;
}
/**
 * A jagged bolt from the top of the frame down to `bottom`, seeded so a strike keeps its shape:
 * a list of [x, y] frame-fraction points plus one short branch.
 * @param {number} x @param {number} bottom @param {number} seed
 */
export function boltPath(x, bottom, seed) {
  /** @type {[number, number][]} */
  const main = [[x + (hash(seed, 1) - 0.5) * 0.04, -0.02]];
  const n = 11;
  for (let k = 1; k <= n; k++) {
    const [px] = main[k - 1];
    main.push([px + (hash(seed, k + 2) - 0.5) * 0.05, -0.02 + ((bottom + 0.02) * k) / n]);
  }
  const from = 3 + Math.floor(hash(seed, 40) * 4);
  /** @type {[number, number][]} */
  const branch = [main[from]];
  for (let k = 1; k <= 4; k++) {
    const [px, py] = branch[k - 1];
    branch.push([px + (hash(seed, 50 + k) * 0.035 + 0.01) * (hash(seed, 60) > 0.5 ? 1 : -1), py + 0.05]);
  }
  return { main, branch };
}

// The lighthouse lamp: on, off, and a dying flicker while `lit` falls between the two.
/** @param {number} lit @param {number} t */
export function lampLevel(lit, t) {
  if (lit >= 0.98 || lit <= 0.02) return clamp01(lit);
  return clamp01(lit * (0.55 + 0.45 * noise(t * 22, 9)) * (noise(t * 7, 4) > 0.3 ? 1 : 0.25));
}

// Every moment the picture changes in a compiled tableau (scene seconds): element entrances,
// keyframes, strikes and camera moves. The compiler's propTimes already sees every `t`; this is for
// callers that want them named.
/** @param {any} props */
export function tableauTimes(props) {
  /** @type {number[]} */
  const out = [];
  for (const e of props?.elements ?? []) {
    if (!e.settled && (e.t ?? 0) > 0) out.push(e.t);
    for (const k of e.to ?? []) out.push(k.t ?? 0);
    for (const s of e.strikes ?? []) out.push(s.t ?? 0);
  }
  for (const [i, k] of (props?.camera ?? []).entries()) if (i > 0) out.push(k.t ?? 0);
  return out.sort((a, b) => a - b);
}

// Geometry of the solid pieces, as the renderer draws them (Tableau.tsx), on the element's own
// layer before the camera: the box it fills and named points on it. Frame fractions; `W`/`H` the
// frame in px (sizes are fractions of its short edge), `horizon` the sea line a boat floats on.
// Camera keys (`on`) aim at these points, an element placed `on` another stands on one, and the
// framing gate checks the box against the frame. Kinds without a body (sky, sea, rain…) give null.
/** @typedef {{ box: [number, number, number, number], anchors: Record<string, [number, number]>, depth: number }} Geometry */
export const SOLID = ["lighthouse", "hut", "boat", "figure", "fire", "moon", "sun"];
/** Kinds a camera key or an `on` can name: the solid ones plus rows meant to run off the frame. */
export const BODIES = [...SOLID, "town", "trees"];
/** @param {any} s an element state (elementAt) @param {{ W: number, H: number, horizon?: number }} frame @returns {Geometry | null} */
export function elementGeometry(s, { W, H, horizon = 0.66 }) {
  const S = Math.min(W, H), sx = S / W, sy = S / H;
  const x = s.x ?? 0.5, f = s.facing ?? 1, depth = s.depth ?? KINDS[s.type]?.depth ?? 0.5;
  /** @param {[number, number, number, number]} box @param {Record<string, [number, number]>} extra */
  const geo = (box, extra) => /** @type {Geometry} */ ({ box, depth, anchors: { center: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], top: [(box[0] + box[2]) / 2, box[1]], ...extra } });
  switch (s.type) {
    case "lighthouse": {
      const h = s.h, y = s.y, hw = (0.1 * h * H) / W;
      return geo([x - hw, y - 1.07 * h, x + hw, y], { base: [x, y], gallery: [x, y - 0.78 * h], lamp: [x, y - 0.87 * h] });
    }
    case "hut": {
      const z = s.size, y = s.y;
      return geo([x - 0.62 * z * sx, y - 1.05 * z * sy, x + 0.62 * z * sx, y], { base: [x, y], window: [x + 0.13 * z * sx, y - 0.34 * z * sy] });
    }
    case "boat": {
      const L = s.size, y = s.y ?? bandBase(bandFor(depth), horizon);
      return geo([x - 0.58 * L * sx, y - 0.82 * L * sy, x + 0.58 * L * sx, y + 0.08 * L * sy], { base: [x, y], deck: [x, y - 0.12 * L * sy], lantern: [x - 0.18 * L * f * sx, y - 0.3 * L * sy] });
    }
    case "figure": {
      const L = s.size, y = s.y;
      return geo([x - 0.28 * L * sx, y - L * sy, x + 0.28 * L * sx, y], { base: [x, y], head: [x + 0.07 * L * f * sx, y - 0.87 * L * sy], lantern: [x + 0.24 * L * f * sx, y - 0.37 * L * sy] });
    }
    case "fire": {
      const r = s.r, y = s.y;
      return geo([x - 1.1 * r * sx, y - 2.6 * r * sy, x + 1.1 * r * sx, y + 0.1 * r * sy], { base: [x, y] });
    }
    case "town": case "trees": {
      const half = s.spread / 2, y = s.y, top = Math.max(...(s.type === "town" ? townBlocks(s).map((b) => b.h) : treeRow(s).map((p) => p.size)));
      return geo([x - half, y - top * sy, x + half, y], { base: [x, y] });
    }
    case "moon": case "sun": {
      const r = s.r, y = s.y;
      return geo([x - r * sx, y - r * sy, x + r * sx, y + r * sy], { base: [x, y + r * sy] });
    }
    default: return null;
  }
}

/** Where a layer point lands on screen under a camera. @param {Cam} cam @param {number} depth @param {[number, number]} p @returns {[number, number]} */
export function onScreen(cam, depth, [px, py]) {
  const v = layerView(cam, depth);
  return [(px - v.cx) * v.scale + 0.5, (py - v.cy) * v.scale + 0.5];
}
/** A layer box on screen. @param {Cam} cam @param {number} depth @param {[number, number, number, number]} box */
export function boxOnScreen(cam, depth, box) {
  const [a, b] = onScreen(cam, depth, [box[0], box[1]]), [c, d] = onScreen(cam, depth, [box[2], box[3]]);
  return /** @type {[number, number, number, number]} */ ([a, b, c, d]);
}

/**
 * The camera (focus x/y) that puts layer point `p` at depth `depth` on screen at `place` with
 * `zoom` — layerView solved backwards, so a key can name what it looks at instead of where.
 * @param {[number, number]} p @param {number} depth @param {number} zoom @param {[number, number]} [place]
 */
export function cameraFor([px, py], depth, zoom, [sx, sy] = [0.5, 0.5]) {
  const k = 0.25 + 0.75 * clamp01(depth), scale = 1 + (zoom - 1) * k;
  const solve = (/** @type {number} */ p, /** @type {number} */ s) => 0.5 + (p - (s - 0.5) / scale - 0.5) / k;
  return { x: solve(px, sx), y: solve(py, sy) };
}
/** The zoom at which a layer box `fill`s that share of the frame's height (and fits its width). @param {[number, number, number, number]} box @param {number} depth @param {number} fill */
export function zoomToFit(box, depth, fill) {
  const k = 0.25 + 0.75 * clamp01(depth);
  const scale = Math.min(fill / Math.max(1e-3, box[3] - box[1]), 0.9 / Math.max(1e-3, box[2] - box[0]));
  return Math.max(1, 1 + (scale - 1) / k);
}

/** How much of a screen box is inside the frame (0..1). @param {[number, number, number, number]} b */
export function insideShare(b) {
  const area = Math.max(1e-9, (b[2] - b[0]) * (b[3] - b[1]));
  const w = Math.max(0, Math.min(1, b[2]) - Math.max(0, b[0])), h = Math.max(0, Math.min(1, b[3]) - Math.max(0, b[1]));
  return (w * h) / area;
}

/** The horizon at t: the sea line (where a boat with no y floats), else the foot of the hills. @param {any[]} elements @param {number} t */
export function horizonAt(elements, t) {
  const ground = elements.find((e) => e.type === "sea") ?? elements.find((e) => e.type === "hills");
  return ground ? elementAt(ground, t).y ?? 0.66 : 0.66;
}

// Land. Hills are `layers` ridgelines, the far one (k 0) tallest and palest, each nearer one a
// little lower down the frame; `rough` 0 rolls, 1 is jagged peaks. ridgeTop gives a layer's crest
// at frame x: its y and how high it stands there (0..1, where snow `cap` settles on the highest).
/** @param {any} s @param {number} k @param {number} x */
export function ridgeTop(s, k, x) {
  const n = Math.max(1, Math.round(s.layers ?? 1)), near = n > 1 ? k / (n - 1) : 1;
  const seed = (s.seed ?? 0) + k * 13, f = 2.2 + 1.6 * k;
  const smooth = noise(x * f, seed) * 0.65 + noise(x * f * 2.3, seed + 1) * 0.35;
  const sharp = Math.pow(1 - Math.abs(2 * noise(x * f * 1.7, seed + 2) - 1), 1.6) * 0.7 + noise(x * f * 5.1, seed + 3) * 0.3;
  const v = clamp01(lerp(smooth, sharp, clamp01(s.rough ?? 0)));
  const amp = (s.h ?? 0.2) * (1 - 0.4 * near * (n > 1 ? 1 : 0));
  return { y: (s.y ?? 0.66) + 0.045 * k - amp * (0.2 + 0.8 * v), v };
}
/** A layer's depth: the far ridge at the element's depth, each nearer one 0.1 closer. @param {any} s @param {number} k */
export const ridgeDepth = (s, k) => Math.min(0.9, (s.depth ?? 0.22) + 0.1 * k);

/** The pines of a row: x, size (short-edge fraction) and foot y, far (higher) ones first. @param {any} s */
export function treeRow(s) {
  const n = Math.max(1, Math.round(s.count ?? 1)), seed = s.seed ?? 0, w = (s.spread ?? 0.6) / n;
  return Array.from({ length: n }, (_, j) => ({
    x: (s.x ?? 0.5) - (s.spread ?? 0.6) / 2 + w * (j + 0.5) + (hash(j, seed) - 0.5) * w * 0.8,
    size: (s.size ?? 0.14) * (0.7 + 0.6 * hash(j, seed + 1)),
    y: (s.y ?? 0.8) + (hash(j, seed + 2) - 0.5) * 0.016,
    j,
  })).sort((a, b) => a.y - b.y);
}

/**
 * The buildings of a town, side by side across `spread`: left edge and width (frame fractions),
 * height (short-edge fraction), a pitched roof or not, and the one tower with a spire.
 * @param {any} s
 */
export function townBlocks(s) {
  const n = Math.max(1, Math.round(s.count ?? 1)), seed = s.seed ?? 0, spread = s.spread ?? 0.6;
  const raw = Array.from({ length: n }, (_, j) => 0.6 + hash(j, seed + 3) * 0.9), sum = raw.reduce((a, b) => a + b, 0);
  const tower = Math.floor(hash(seed, 77) * n);
  let left = (s.x ?? 0.5) - spread / 2;
  return raw.map((r, j) => {
    const w = (spread * r) / sum, b = { x: left, w, h: (s.size ?? 0.12) * (j === tower ? 1 : 0.35 + 0.5 * hash(j, seed + 4)), roof: j !== tower && hash(j, seed + 5) > 0.55, spire: j === tower, j };
    left += w;
    return b;
  });
}
/** Whether window (row, col) of building j is lit when the town's `lit` is at that level. @param {number} j @param {number} row @param {number} col @param {number} seed @param {number} lit */
export const windowOn = (j, row, col, seed, lit) => hash(j * 31 + row * 7 + 1, col + seed * 5 + 3) < lit;
