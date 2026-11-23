// @ts-check
import { easeInOut } from "./ease.mjs";

/** @param {{duration: number, cues?: Record<string, number>}} scene
 * @param {number} count @param {(string | null)[]} names @param {number} start */
export function linePointTimes(scene, count, names, start) {
  if (count < 2 || !names.slice(0, count).some((name) => name != null && scene.cues?.[name] !== undefined)) return null;
  const times = Array.from({ length: count }, (_, k) => {
    const name = names[k];
    return name ? scene.cues?.[name] : undefined;
  });
  times[0] ??= start;
  times[count - 1] ??= Math.max(times[0], scene.duration * 0.72);
  let a = 0;
  for (let k = 1; k < count; k++) {
    if (times[k] === undefined) continue;
    times[k] = Math.max(times[a] ?? 0, times[k] ?? 0);
    for (let j = a + 1; j < k; j++) times[j] = (times[a] ?? 0) + ((times[k] ?? 0) - (times[a] ?? 0)) * (j - a) / (k - a);
    a = k;
  }
  return /** @type {number[]} */ (times);
}

/** @param {number} previous @param {number} at */
export const lineSegmentStart = (previous, at) => at - Math.min(3, 0.8 * (at - previous));

/** @param {number[]} times @param {number} t */
export function lineProgress(times, t) {
  return times.slice(1).reduce((pos, at, k) => {
    if (t >= at) return pos + 1;
    const start = lineSegmentStart(times[k], at);
    return pos + (t > start ? easeInOut((t - start) / (at - start)) : 0);
  }, 0);
}
