// @ts-check

/** @param {number} height @param {number} u @param {boolean} portrait */
export const deviceViewportHeight = (height, u, portrait) => height - (portrait ? 390 : 220) * u;

/** @param {number} height @param {number} u @param {boolean} portrait */
export const deviceCaptionSlot = (height, u, portrait) => ({
  top: deviceViewportHeight(height, u, portrait) + 8 * u,
  bottom: 14 * u,
  width: portrait ? 0.88 : 0.8,
});

/** @param {number} count @param {number | undefined} columns @param {boolean} portrait */
export function statCardColumns(count, columns, portrait) {
  const natural = portrait ? (count > 3 ? 2 : 1) : count === 4 ? 2 : 3;
  return Math.max(1, Math.min(count, columns ?? natural, portrait ? natural : Infinity));
}
