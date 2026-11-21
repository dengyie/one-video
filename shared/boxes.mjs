// @ts-check
// Boxes as [x0, y0, x1, y1] (frame fractions or px; the caller picks the unit and keeps it).

/** @typedef {[number, number, number, number]} Rect */

/** Whether two boxes overlap (touching edges do not).
 * @param {Rect} a @param {Rect} b */
export const meets = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
/** @param {Rect} b */
export const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
/** Area of the overlap of two boxes.
 * @param {Rect} a @param {Rect} b */
export const overlap = (a, b) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
/** @param {Rect} b @param {number} dx @param {number} dy @returns {Rect} */
export const shift = (b, dx, dy) => [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
