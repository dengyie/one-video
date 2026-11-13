// Caption placement: where the caption band sits under the shot framing, and which lines move to
// the top because the depth subject fills the band.
import { depthAt, subjectShare } from "../vision/subject.mjs";

// The caption band (screen) in the scene's own frame coordinates under the shot framing at t.
export function captionBand(shots, t, portrait = false) {
  const sh = [...(shots ?? [])].reverse().find((s) => s.t <= t) ?? { zoom: 1, x: 0.5, y: 0.5 };
  const back = (v, c) => c + (v - 0.5) / sh.zoom;
  const [y0, y1] = portrait ? [0.74, 0.86] : [0.84, 0.96];
  return [back(0.2, sh.x), back(y0, sh.y), back(0.8, sh.x), back(y1, sh.y)];
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
