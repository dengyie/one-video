import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";
import { readJson, writeJson } from "./project.mjs";

export const qcBoundsPath = (video) => `${video}.qc-bounds.json`;
function identity(video) {
  const fd = openSync(video, "r");
  try {
    const { size } = fstatSync(fd);
    const edge = Buffer.alloc(Math.min(size, 64 * 1024));
    const hash = createHash("sha256");
    for (const offset of new Set([0, size - edge.length])) {
      const n = readSync(fd, edge, 0, edge.length, offset);
      hash.update(edge.subarray(0, n));
    }
    return { size, signature: hash.digest("hex") };
  } finally { closeSync(fd); }
}

const isRect = (box) => Array.isArray(box) && box.length === 4 && box.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)
  && box[0] < box[2] && box[1] < box[3];

export function readQcBounds(video) {
  try {
    const data = readJson(qcBoundsPath(video), null);
    if (!data || data.version !== 1 || !Number.isInteger(data.step) || data.step < 1 || !Array.isArray(data.samples)) return null;
    const { size, signature } = identity(video);
    if (data.size !== size || data.signature !== signature) return null;
    return { step: data.step, samples: data.samples.map((boxes) => Array.isArray(boxes) && boxes.every(isRect) ? boxes : null) };
  } catch { return null; }
}

export function writeQcBounds(video, { step, samples }) {
  writeJson(qcBoundsPath(video), { version: 1, ...identity(video), step, samples });
}
