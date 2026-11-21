// @ts-check
// Reveal rhythm: when item i of n in a scene comes in. The renderer staggers lists, pins and bars
// with it and the gates predict the same moments, so a gate that says "on screen at 2.1s" agrees
// with the frame.

/** Motion pace multipliers (theme.motion.pace): slower pace, later and longer reveals. */
export const PACE = /** @type {const} */ ({ slow: 1.35, medium: 1, fast: 0.7 });

/** @param {string | undefined} pace @returns {number} */
export const paceOf = (pace) => (pace && pace in PACE ? PACE[/** @type {keyof typeof PACE} */ (pace)] : 1);

/** @typedef {{ duration: number, cues?: Record<string, number | null | undefined> }} SceneLike */

/** When item i of n appears: its named cue if the scene has it, otherwise a stagger spread across
 * the first ~55% of the scene so reveals follow the narration loosely.
 * @param {SceneLike} scene @param {number} pace @param {number} i @param {number} n @param {string} [cue] @returns {number} */
export function revealAt(scene, pace, i, n, cue) {
  const named = cue ? scene.cues?.[cue] : undefined;
  if (typeof named === "number") return named;
  const first = 0.35 * pace;
  const span = Math.max(0, Math.min(scene.duration * 0.55, n * 1.4 * pace) - first);
  return n <= 1 ? first : first + (span * i) / (n - 1);
}

/** A named cue's time, or `fallback` when the scene has none by that name.
 * @param {SceneLike} scene @param {string | undefined} name @param {number} fallback @returns {number} */
export function cueOr(scene, name, fallback) {
  const v = name ? scene.cues?.[name] : undefined;
  return typeof v === "number" ? v : fallback;
}
