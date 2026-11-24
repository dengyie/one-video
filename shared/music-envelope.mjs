// @ts-check
import { clamp01 } from "./ease.mjs";

/**
 * @param {number} fps
 * @param {number} duration
 * @param {{volume: number, duckTo: number, fade: number}} music
 * @param {[number, number][]} narration
 */
export function musicVolumeProps(fps, duration, music, narration) {
  return {
    loopVolumeCurveBehavior: /** @type {const} */ ("extend"),
    volume: (/** @type {number} */ frame) => {
      const t = frame / fps;
      let distance = Infinity;
      for (const [a, b] of narration) {
        if (t >= a && t <= b) { distance = 0; break; }
        distance = Math.min(distance, t < a ? a - t : t - b);
      }
      const duck = music.duckTo + (music.volume - music.duckTo) * clamp01(distance / 0.35);
      const fade = Math.min(clamp01(t / music.fade), clamp01((duration - t) / music.fade));
      return duck * fade;
    },
  };
}
