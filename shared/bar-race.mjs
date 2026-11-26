// @ts-check

/** @param {number} untilNextSwap @param {number} [maxSwapDuration] */
export const barRaceSwapDuration = (untilNextSwap, maxSwapDuration = 1.6) =>
  Math.max(0.3, Math.min(maxSwapDuration, untilNextSwap * 0.6));
