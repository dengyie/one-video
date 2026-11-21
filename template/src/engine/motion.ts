// The base curves are shared with the CLI (shared/ease.mjs), so its models move like the render.
import { clamp01, easeOut } from "../../../shared/ease.mjs";
export { clamp01, easeOut, easeInOut, lerp } from "../../../shared/ease.mjs";
export const easeOutBack = (t: number) => {
  const x = clamp01(t);
  const c1 = 1.4, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

// Progress 0→1 of an entrance that starts at `at` seconds and lasts `dur` seconds.
export const progress = (t: number, at: number, dur = 0.6) => easeOut((t - at) / dur);

export { PACE } from "../../../shared/reveal.mjs";
