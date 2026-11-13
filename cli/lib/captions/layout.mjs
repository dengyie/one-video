// Caption placement: where the caption band sits under the shot framing, and which lines move to
// the top because the depth subject fills the band.
import { depthAt, subjectShare } from "../vision/subject.mjs";

// The caption band (screen) in the scene's own frame coordinates under the shot framing at t.
export function captionBand(shots, t, portrait = false) {
  const sh = viewAt(shots, t);
  const back = (v, c) => c + (v - 0.5) / sh.zoom;
  const [y0, y1] = portrait ? [0.74, 0.86] : [0.84, 0.96];
  return [back(0.2, sh.x), back(y0, sh.y), back(0.8, sh.x), back(y1, sh.y)];
}

// The shot framing at t as the renderer computes it (engine/camera.ts viewAt): each shot eases from
// the previous framing over its `ease` seconds, a cut jumps.
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export function viewAt(shots, t) {
  if (!shots?.length) return { zoom: 1, x: 0.5, y: 0.5 };
  let v = { zoom: shots[0].zoom ?? 1, x: shots[0].x ?? 0.5, y: shots[0].y ?? 0.5 };
  for (const s of shots) {
    if (t < s.t) break;
    const p = s.cut ? 1 : ease((t - s.t) / Math.max(0.01, s.ease ?? 0.6));
    v = { zoom: v.zoom + ((s.zoom ?? 1) - v.zoom) * p, x: v.x + ((s.x ?? 0.5) - v.x) * p, y: v.y + ((s.y ?? 0.5) - v.y) * p };
  }
  return v;
}

// A backdrop dimmed or blurred this far no longer shows a subject the caption could cover.
export const mutedBackdrop = (b) => (b?.dim ?? 0) >= 0.75 || (b?.blur ?? 0) >= 4;

// A caption line moves to the top (c.top) while the subject fills the caption band. A muted
// backdrop keeps it at the bottom: moving would only make the captions jump between scenes.
export function placeCaptions(scenes, captions, { root, usedAssets, fps, width, height }) {
  const byId = new Map(scenes.map((sc) => [sc.id, sc]));
  for (const c of captions) {
    const sc = byId.get(c.scene);
    if (!sc || (sc.type !== "footage" && sc.type !== "parallax" && mutedBackdrop(sc.backdrop))) continue;
    const t = (c.start + c.end) / 2 - sc.start;
    const d = depthAt(root, sc, usedAssets, fps, t);
    if (d && subjectShare(d, captionBand(sc.shots, t, height >= width * 1.5), width, height) > 0.25) c.top = true;
  }
}
