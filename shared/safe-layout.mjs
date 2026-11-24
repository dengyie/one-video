// @ts-check
import { textEms } from "./labels.mjs";
import { cameraViewport } from "./camera.mjs";

/** @typedef {{title: string, subtitle?: string}} Header */

/** @param {number} width @param {number} height @param {Header | null | undefined} header */
export function layoutTop(width, height, header) {
  const portrait = height >= width * 1.5;
  const u = Math.min(width, height) / 1080;
  const pad = (portrait ? 64 : 96) * u;
  const block = (/** @type {string} */ text, /** @type {number} */ size, /** @type {number} */ latin) =>
    Math.max(1, Math.ceil((textEms(text, latin) * size * u) / (width - pad * 2))) * size * u * 1.45;
  const below = header
    ? (portrait ? 120 : 56) * u + block(header.title, portrait ? 60 : 48, 0.62) + (header.subtitle ? 8 * u + block(header.subtitle, portrait ? 32 : 25, 0.55) : 0) + 20 * u
    : 0;
  return Math.max((portrait ? 220 : 190) * u, below);
}

/** @param {{type?: string, header?: Header | null}} scene @param {number} width @param {number} height */
export function canvasViewport(scene, width, height) {
  return scene.type === "canvas" && scene.header ? cameraViewport(height, layoutTop(width, height, scene.header)) : null;
}

/** @param {number} u @param {boolean} portrait */
export const captionPlateMetrics = (u, portrait) => ({
  bottom: (portrait ? 300 : 46) * u, fontSize: (portrait ? 54 : 42) * u,
  lineHeight: 1.35, padX: 28 * u, padY: 10 * u, width: portrait ? 0.88 : 0.8,
});

/** @param {string} text @param {number} width @param {number} height @param {boolean} portrait */
export function captionPlateSlot(text, width, height, portrait) {
  const u = Math.min(width, height) / 1080;
  const m = captionPlateMetrics(u, portrait);
  const advance = textEms(text) * m.fontSize + [...text].length * 0.5 * u;
  const room = width * m.width - 2 * m.padX;
  const lines = Math.max(1, Math.ceil(advance / room));
  const plateHeight = lines * m.fontSize * m.lineHeight + 2 * m.padY;
  return { top: height - m.bottom - plateHeight, bottom: m.bottom, width: m.width, height };
}

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
