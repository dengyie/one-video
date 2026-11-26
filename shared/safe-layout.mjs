// @ts-check

import { textEms } from "./labels.mjs";

/** @param {number} height @param {number} u @param {boolean} portrait */
export const deviceViewportHeight = (height, u, portrait) => height - (portrait ? 390 : 220) * u;

/** @param {boolean} portrait */
const captionWidth = (portrait) => portrait ? 0.88 : 0.8;

/** @param {number} height @param {number} u @param {boolean} portrait */
export const deviceCaptionSlot = (height, u, portrait) => ({
  top: deviceViewportHeight(height, u, portrait) + 8 * u,
  bottom: 14 * u,
  width: captionWidth(portrait),
});

/** @param {number} u @param {boolean} portrait */
export const captionPlateMetrics = (u, portrait) => ({
  fontSize: (portrait ? 54 : 42) * u,
  lineHeight: 1.35,
  padX: 28 * u,
  padY: 10 * u,
  letterSpacing: 0.5 * u,
});

/** Authored caption plate in screen fractions. Glyph widths and line breaks are estimated for the
 * pre-render gate; the line height and padding are the renderer's.
 * @param {string} text @param {number} y @param {number} width @param {number} height
 * @param {boolean} portrait @returns {[number, number, number, number]} */
export function authoredCaptionBox(text, y, width, height, portrait) {
  const { fontSize, lineHeight, padX, padY, letterSpacing } = captionPlateMetrics(Math.min(width, height) / 1080, portrait);
  const limit = width * captionWidth(portrait) - 2 * padX;
  let rows = 1, row = 0, widest = 0, space = 0;
  for (const token of text.trim().match(/[\u2e80-\uffef]|[^\s\u2e80-\uffef]+|\s+/gu) ?? []) {
    const advance = textEms(token) * fontSize + [...token].length * letterSpacing;
    if (!token.trim()) { space = advance; continue; }
    if (row && row + space + advance > limit) { widest = Math.max(widest, row); rows++; row = 0; }
    row += (row ? space : 0) + advance;
    space = 0;
  }
  const half = (Math.min(limit, Math.max(widest, row)) + 2 * padX) / width / 2;
  return [0.5 - half, y, 0.5 + half, y + (rows * fontSize * lineHeight + 2 * padY) / height];
}

/** @param {number} count @param {number | undefined} columns @param {boolean} portrait */
export function statCardColumns(count, columns, portrait) {
  const natural = portrait ? (count > 3 ? 2 : 1) : count === 4 ? 2 : 3;
  return Math.max(1, Math.min(count, columns ?? natural, portrait ? natural : Infinity));
}
