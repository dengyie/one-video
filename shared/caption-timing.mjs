// @ts-check
import { clamp01 } from "./ease.mjs";

const LEAD = 0.05;
const LINGER = 0.25;
const FADE = 0.12;

/** @template {{start: number, end: number}} T @param {T[]} items */
export function captionWindows(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const joins = (/** @type {T} */ first, /** @type {T} */ next) => next.start <= first.end + LINGER + 1e-6;
  return sorted.map((item, i) => {
    const prev = sorted[i - 1], next = sorted[i + 1];
    const joinedIn = Boolean(prev && joins(prev, item));
    const joinedOut = Boolean(next && joins(item, next));
    return {
      item,
      start: item.start - (joinedIn ? 0 : LEAD),
      end: joinedOut ? next.start : item.end + LINGER,
      joinedIn,
      joinedOut,
    };
  });
}

/** @template {{start: number, end: number}} T @param {ReturnType<typeof captionWindows<T>>} windows @param {number} t */
export function captionAt(windows, t) {
  let lo = 0, hi = windows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t >= windows[mid].start) lo = mid + 1;
    else hi = mid;
  }
  const window = windows[lo - 1];
  if (!window || t >= window.end) return undefined;
  const fadeIn = window.joinedIn ? 1 : clamp01((t - window.start) / FADE);
  const fadeOut = window.joinedOut ? 1 : clamp01((window.end - t) / FADE);
  return { item: window.item, fadeIn, opacity: Math.min(fadeIn, fadeOut) };
}
