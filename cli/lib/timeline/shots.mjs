// Shot track: framings inside a scene (authored, auto or from a speed ramp) and the hard cuts
// the music offset is tuned against.
import { snapToBar, snapToBeat } from "../audio/beats.mjs";
import { CUE_LEAD, resolveWhen } from "./cues.mjs";
import { slamWord } from "./sfx.mjs";
import { clampT, r3 } from "./util.mjs";

// Auto shot track: one framing per caption line, alternating moves and hard cuts, never far
// enough in to lose a header or a card at the edge.
export const AUTO_SHOTS = [
  { zoom: 1, x: 0.5, y: 0.5 },
  { zoom: 1.12, x: 0.44, y: 0.47 },
  { zoom: 1.07, x: 0.56, y: 0.53, rotate: 0.4 },
  { zoom: 1.16, x: 0.5, y: 0.45 },
];

// Storyboard shots → compiled Shot[]: `focus: [x, y, w, h]` frames a region (zoom to fit it with
// a margin), otherwise x/y/zoom directly. Times snap to a beat within 0.12 s when beats exist;
// a hard cut prefers the bar's downbeat within 0.25 s.
export function compileShots(spec, ctx) {
  const { lines, duration, start, beats, snap } = ctx;
  const out = [];
  const errors = [];
  const list = spec === "auto" || spec?.auto
    ? lines.map((l, i) => ({ ...AUTO_SHOTS[i % AUTO_SHOTS.length], at: i ? Math.max(0, l.start - CUE_LEAD) : 0, cut: i % 2 === 0 && i > 0, ...(typeof spec === "object" ? spec.each ?? {} : {}) }))
    : Array.isArray(spec) ? spec : [];
  for (const [k, sh] of list.entries()) {
    const res = resolveWhen(sh, ctx);
    if (res.error) { errors.push(`shot ${k}: ${res.error}`); continue; }
    let t = clampT(res.t, duration);
    if (snap && beats.length && sh.snap !== false) t = (sh.cut ? snapToBar(start + t, beats, ctx.downbeats) : snapToBeat(start + t, beats, 0.12)) - start;
    let { zoom = 1, x = 0.5, y = 0.5 } = sh;
    if (Array.isArray(sh.focus)) {
      const [fx, fy, fw, fh] = sh.focus;
      zoom = sh.zoom ?? Math.min(3, Math.max(1, 0.8 / Math.max(fw, fh)));
      x = fx + fw / 2; y = fy + fh / 2;
    }
    out.push({ t: r3(clampT(t, duration)), zoom: r3(zoom), x: r3(x), y: r3(y), rotate: r3(sh.rotate ?? 0), cut: Boolean(sh.cut), ease: r3(sh.ease ?? 0.6) });
  }
  out.sort((a, b) => a.t - b.t);
  return { shots: out, errors };
}

// A speed ramp only moves footage that is a clip. On a still (a photo, or one standing in for a clip
// that failed to generate) it becomes camera moves: slow-mo stretches a slow push (two when longer
// than 3 s, so the frame keeps changing), a speed-up a quick push (its whoosh comes from the ramp). Authored shots win: a ramp move
// waits until an authored move in progress has finished and skips points an authored shot claims.
export function rampShots(ramp, shots, duration) {
  const own = shots ?? [];
  const keys = (ramp ?? []).filter((r) => Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
  const added = [];
  const all = () => [...own, ...added].sort((a, b) => a.t - b.t);
  const viewAt = (t) => [...all()].reverse().find((sh) => sh.t <= t) ?? { zoom: 1, x: 0.5, y: 0.5 };
  const busyUntil = (t) => Math.max(t, ...own.filter((sh) => sh.t <= t).map((sh) => sh.t + (sh.cut ? 0 : sh.ease)));
  const push = (t, dz, ease) => {
    if (own.some((sh) => Math.abs(sh.t - t) < 0.3)) return;
    const v = viewAt(t);
    added.push({ t: r3(t), zoom: r3(Math.min(3, v.zoom + dz)), x: v.x, y: v.y, rotate: 0, cut: false, ease: r3(ease) });
  };
  for (const [i, r] of keys.entries()) {
    const end = Math.min(duration, keys[i + 1]?.t ?? duration);
    if (r.speed > 1.3) { push(r.t, 0.1, 0.35); continue; }
    if (r.speed >= 1) continue;
    const from = Math.min(end, busyUntil(r.t)), len = end - from;
    if (len < 0.8) continue;
    const parts = len > 3 ? 2 : 1;
    for (let k = 0; k < parts; k++) push(from + (k * len) / parts, 0.06, len / parts);
  }
  return added.length ? all() : own;
}

// A shot that barely moves the frame from the one before: no cut, zoom and position within a few
// percent, under a degree of roll. A viewer doesn't read it as anything new.
export const weakMove = (prev, sh) => !!prev && !sh.cut && Math.abs((sh.zoom ?? 1) - (prev.zoom ?? 1)) < 0.05 && Math.abs((sh.x ?? 0.5) - (prev.x ?? 0.5)) < 0.03 && Math.abs((sh.y ?? 0.5) - (prev.y ?? 0.5)) < 0.03 && Math.abs((sh.rotate ?? 0) - (prev.rotate ?? 0)) < 1;

// A stretch longer than `maxStill` with nothing new on screen (no reveal in `times`, no real shot
// move) gets a slow drift every ≤3 s: 6% in (out once past 1.2×), travelling over most of the gap.
// Authored shots win: a drift waits for a move in progress, keeps 0.3 s off any shot, and is dropped
// when it would leave the next move too small to see.
export function stillShots(shots, times, duration, maxStill) {
  if (!shots?.length) return shots;
  let all = [...shots].sort((a, b) => a.t - b.t);
  const marks = [...new Set([0, ...times, ...all.filter((sh, i) => !weakMove(all[i - 1], sh)).map((sh) => sh.t)])]
    .filter((t) => t >= 0 && t <= duration).sort((a, b) => a - b);
  marks.push(duration);
  for (let i = 0; i + 1 < marks.length; i++) {
    const from = marks[i], to = marks[i + 1], len = to - from;
    if (len <= maxStill) continue;
    const n = Math.ceil(len / 3) - 1, step = len / (n + 1);
    for (let k = 1; k <= n; k++) {
      const busy = Math.max(0, ...all.filter((sh) => sh.t <= from + k * step && !sh.cut).map((sh) => sh.t + sh.ease));
      const t = Math.max(from + k * step, busy);
      if (t > to - 0.8 || all.some((sh) => Math.abs(sh.t - t) < 0.3)) continue;
      const v = [...all].reverse().find((sh) => sh.t <= t) ?? all[0];
      const sh = { t: r3(t), zoom: r3(v.zoom + (v.zoom + 0.06 > 1.2 ? -0.06 : 0.06)), x: v.x, y: v.y, rotate: v.rotate ?? 0, cut: false, ease: r3(step * 0.9) };
      const next = all.find((s) => s.t > t);
      if (next && weakMove(sh, next) && !weakMove(v, next)) continue;
      all = [...all, sh].sort((a, b) => a.t - b.t);
    }
  }
  return all.length > shots.length ? all : shots;
}

// Moments a viewer feels as hits, in seconds with a weight: scene boundaries, hard shot cuts and
// slammed words (half weight).
export function hardCuts(timeline) {
  const out = [];
  timeline.scenes.forEach((sc, i) => {
    if (i) out.push({ at: sc.from / timeline.fps, w: 1 });
    for (const sh of sc.shots ?? []) if (sh.cut && sh.t > 0) out.push({ at: sc.start + sh.t, w: 1 });
    for (const o of sc.overlays ?? []) if (slamWord(o)) out.push({ at: sc.start + o.t, w: 0.5 });
  });
  return out;
}

// Track start (0 to one bar, 10 ms steps) that puts the weighted hits nearest the downbeats;
// each hit counts at most 0.3 s off, so one stray hit can't drag the rest.
export function bestOffset(hits, downbeats) {
  if (!hits.length || downbeats.length < 2) return 0;
  const bar = downbeats[1] - downbeats[0];
  const near = (t) => downbeats.reduce((m, d) => Math.min(m, Math.abs(d - t)), Infinity);
  let best = { off: 0, score: Infinity };
  for (let off = 0; off < bar; off = r3(off + 0.01)) {
    const score = hits.reduce((s, h) => s + h.w * Math.min(0.3, near(h.at + off)), 0);
    if (score < best.score - 1e-6) best = { off, score };
  }
  return best.off;
}
