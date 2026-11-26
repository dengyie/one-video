// Caption placement: where the caption band sits under the shot framing, and which lines move to
// the top because the depth subject fills the band.
import { depthAt, subjectShare } from "../vision/subject.mjs";
import { captionBand } from "../../../shared/camera.mjs";

// The caption band and the shot framing are the renderer's own model (shared/camera.mjs), so a
// caption judged clear here is clear in the render.
export { captionBand };

// A backdrop dimmed or blurred this far no longer shows a subject the caption could cover.
export const mutedBackdrop = (b) => (b?.dim ?? 0) >= 0.75 || (b?.blur ?? 0) >= 4;

// A caption line moves to the top (c.top) while the subject fills the caption band. A muted
// backdrop keeps it at the bottom: moving would only make the captions jump between scenes.
export function placeCaptions(scenes, captions, { root, usedAssets, fps, width, height, captionY }) {
  const byId = new Map(scenes.map((sc) => [sc.id, sc]));
  for (const c of captions) {
    const sc = byId.get(c.scene);
    if (!sc) continue;
    const y = captionY?.get(sc.id);
    if (sc.type !== "device" && y !== undefined) {
      c.y = y;
      continue;
    }
    if (sc.type !== "footage" && sc.type !== "parallax" && mutedBackdrop(sc.backdrop)) continue;
    const t = (c.start + c.end) / 2 - sc.start;
    const d = depthAt(root, sc, usedAssets, fps, t);
    if (d && subjectShare(d, captionBand(sc.shots, t, height >= width * 1.5), width, height) > 0.25) c.top = true;
  }
}
