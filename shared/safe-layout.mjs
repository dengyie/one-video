// @ts-check

/** @param {number} height @param {number} u @param {boolean} portrait */
export const deviceViewportHeight = (height, u, portrait) => height - (portrait ? 390 : 220) * u;

/** @param {number} count @param {number | undefined} columns @param {boolean} portrait */
export function statCardColumns(count, columns, portrait) {
  const natural = portrait ? (count > 3 ? 2 : 1) : count === 4 ? 2 : 3;
  return Math.max(1, Math.min(count, columns ?? natural, portrait ? natural : Infinity));
}
