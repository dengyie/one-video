// @ts-check
import { easeInOut } from "./ease.mjs";

/** @param {"in" | "out"} side @param {number} frame @param {number} frames @param {number} split */
export function dipOpacity(side, frame, frames, split) {
  return side === "out"
    ? 1 - easeInOut(frame / Math.max(1, split))
    : easeInOut((frame - split) / Math.max(1, frames - split));
}

/** @param {"in" | "out"} side @param {number} p */
export const zoomScale = (side, p) => side === "in" ? 0.975 + 0.025 * p : 1 + 0.02 * p;

/** @param {number} p @param {number} length */
export const whipBlur = (p, length) => Math.sin(Math.PI * p) * 0.009 * length;
