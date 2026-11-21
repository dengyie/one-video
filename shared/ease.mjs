// @ts-check
// Easing shared by the renderer (template/) and the CLI's models of it (gates, captions): the
// camera, map flights and label placement must move the same way in both.

/** @param {number} x */
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** @param {number} a @param {number} b @param {number} t */
export const lerp = (a, b, t) => a + (b - a) * t;
/** @param {number} t */
export const easeOut = (t) => 1 - Math.pow(1 - clamp01(t), 3);
/** @param {number} t */
export const easeInOut = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
