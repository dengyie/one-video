// @ts-check
// Map label placement, in px of the frame: pin labels, country labels and route labels step clear
// of the labels placed before them in the same frame and stay inside what the shots keep on screen.
// The Map scene draws with it and the layout gate predicts the same boxes, so a gate warning means
// the render really stacks them.
import { meets } from "./boxes.mjs";
import { easeInOut } from "./ease.mjs";

/** @typedef {import("./boxes.mjs").Rect} LabelBox */

export const LABEL_FONT = 28;
export const LABEL_H = 52;

/** Advance of a run of text in em: CJK ≈ 1em per character, the rest ≈ `latin` em.
 * @param {string} text @param {number} [latin] */
export const textEms = (text, latin = 0.6) => [...text].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 1 : latin), 0);

/** Label width in u, estimated from the text at the label font plus padding.
 * @param {string} text */
export const labelWidth = (text) => textEms(text) * LABEL_FONT + 36;

/** Centre x that keeps a centred label of width w inside the on-screen span [l, r] (24u margin).
 * @param {number} x @param {number} w @param {[number, number]} span @param {number} u */
export const inFrame = (x, w, [l, r], u) => Math.min(Math.max(x, l + 24 * u + w / 2), r - 24 * u - w / 2);

/** A centred label at (x, y) that would overlap a label already placed steps `dir` (1 down, -1 up)
 * a row at a time until clear (at most 6 rows); a visible one (o > 0) is then added to `placed`.
 * Returns its centre.
 * @param {LabelBox[]} placed @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {1 | -1} dir @param {number} u @param {number} [o] @returns {[number, number]} */
export function clearOf(placed, x, y, w, h, dir, u, o = 1) {
  /** @type {LabelBox} */
  let box = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
  for (let k = 0; k < 6 && placed.some((p) => meets(p, box)); k++) box = [box[0], box[1] + dir * (h + 6 * u), box[2], box[3] + dir * (h + 6 * u)];
  if (o > 0) placed.push(box);
  return [x, (box[1] + box[3]) / 2];
}

/**
 * @template {{ x: number, y: number, text: string, o: number }} T
 * Pin labels go right of their pin; when one would overlap an earlier label or run off the frame
 * it flips to the left, then steps down until clear, and stays inside the frame. Their boxes go
 * into `placed`. Each placed label comes back with x at its left edge and y at its middle.
 * @param {(T | null)[]} items @param {number} u @param {[number, number]} span @param {LabelBox[]} [placed]
 * @returns {(T & { box: LabelBox })[]}
 */
export function placePinLabels(items, u, [l, r], placed = []) {
  const out = [];
  for (const it of items) {
    if (!it || it.o <= 0) continue;
    const w = labelWidth(it.text) * u, h = LABEL_H * u;
    let x = it.x + 22 * u, y = it.y - 26 * u - h / 2;
    /** @returns {LabelBox} */
    const box = () => [x, y, x + w, y + h];
    if (placed.some((p) => meets(p, box())) || x + w > r - 24 * u) x = it.x - 22 * u - w;
    if (x < l + 24 * u) x = Math.min(it.x + 22 * u, r - 24 * u - w);
    for (let k = 0; k < 6 && placed.some((p) => meets(p, box())); k++) y += h + 6 * u;
    placed.push(box());
    out.push({ ...it, x, y: y + h / 2, box: box() });
  }
  return out;
}

/** Point on the near hemisphere of an orthographic globe centred on `c` ([lon, lat] degrees).
 * @param {[number, number]} p @param {[number, number]} c */
export function visibleOnGlobe(p, c) {
  const r = Math.PI / 180;
  const cos = Math.sin(p[1] * r) * Math.sin(c[1] * r) + Math.cos(p[1] * r) * Math.cos(c[1] * r) * Math.cos((p[0] - c[0]) * r);
  return cos > 0.05;
}

/** @typedef {{ center: [number, number], zoom: number }} MapView */

/** Map camera through its views: hold each, ease to the next over `fly` seconds ending at its start
 * (shortest way round in longitude, zoom eased in log space).
 * @param {MapView[]} views @param {number[]} starts @param {number} t @param {number} fly
 * @returns {{ center: [number, number], zoom: number }} */
export function mapViewAt(views, starts, t, fly) {
  let c = views[0].center, z = Math.log(views[0].zoom);
  for (let i = 1; i < views.length; i++) {
    const p = easeInOut((t - (starts[i] - fly)) / fly);
    if (p <= 0) break;
    let dLon = views[i].center[0] - c[0];
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    c = [c[0] + dLon * p, c[1] + (views[i].center[1] - c[1]) * p];
    z = z + (Math.log(views[i].zoom) - z) * p;
  }
  return { center: c, zoom: Math.exp(z) };
}
