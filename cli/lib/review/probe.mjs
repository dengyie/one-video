// Stickers over scene text, from the boxes the stills probe measured on screen (template/stills.mjs,
// Overlay.tsx probeBoxes): titles, chart labels and card text the layout gate cannot model.
// The last stills run of each frame is kept (out/qc/probe.<aspect>.json) for onevideo fix, as long as
// the storyboard it measured is still the one on disk.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "../core/project.mjs";
import { productsHash } from "../core/state.mjs";
const meets = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const cut = (a, b) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
// A sticker counts as covering a line once it hides about a third of one character (a glyph is
// roughly line-height square); a graze along an edge reads fine.
export const COVER_GLYPH = 0.35;

// A height for the overlay, in hundredths, the nearest first, where its measured box clears every
// measured line and stays out of the caption band and inside the frame.
function clearY(o, box, texts, portrait) {
  const band = portrait ? [0.74, 0.86] : [0.84, 0.96];
  const y0 = o.y ?? 0.5;
  for (let d = 1; d <= 80; d++) for (const s of [-1, 1]) {
    const dy = (s * d) / 100;
    const b = [box[0], box[1] + dy, box[2], box[3] + dy];
    if (b[1] < 0.02 || b[3] > 0.98 || (b[3] > band[0] && b[1] < band[1])) continue;
    if (texts.some((t) => meets(t.box, b))) continue;
    return Math.round((y0 + dy) * 100) / 100;
  }
  return null;
}

// `variant` is the --aspect of a cut other than the main one: its fix goes to the overlay's
// aspects[variant], leaving the main cut where it is.
export function probeIssues(probes, timeline, { variant = null } = {}) {
  const portrait = timeline.height >= timeline.width * 1.5;
  const glyph = (b) => (b[3] - b[1]) ** 2 * (timeline.height / timeline.width);
  const byId = new Map(timeline.scenes.map((s) => [s.id, s]));
  const out = [], said = new Set();
  for (const p of probes) for (const rec of p.scenes ?? []) {
    const sc = byId.get(rec.scene);
    if (!sc) continue;
    for (const { i, box, covers } of rec.overlays) {
      const o = sc.overlays?.[i];
      if (!o) continue;
      // Hit-tested coverage when the probe measured it, else the bounding boxes' overlap.
      const hidden = covers ? new Map(covers.map((c) => [rec.texts[c.t], c.area])) : null;
      const hit = rec.texts.filter((t) => (hidden ? hidden.get(t) ?? 0 : cut(t.box, box)) > COVER_GLYPH * Math.min(glyph(t.box), area(t.box)));
      const fresh = hit.filter((t) => !said.has(`${sc.id}#${i}#${t.text}`));
      if (!fresh.length) continue;
      for (const t of fresh) said.add(`${sc.id}#${i}#${t.text}`);
      const name = `scene "${sc.id}" overlay ${i} (${o.type}${o.text ? ` "${o.text}"` : o.asset ? ` ${o.asset}` : ""})`;
      const y = o.on ? null : clearY(o, box, rec.texts, portrait);
      const at = { scene: sc.id, from: sc.start + o.t, to: sc.start + Math.min(o.end, sc.duration), field: `overlays[${i}]` };
      const fix = y === null ? undefined : variant
        ? { scene: sc.id, path: ["overlays", i, "aspects"], set: { [variant]: { y } }, add: true }
        : { scene: sc.id, path: ["overlays", i], set: { y } };
      out.push({
        level: "warn", gate: "probe", fix,
        msg: `${name} covers ${fresh.map((t) => `"${t.text}"`).join(", ")} at ${(sc.start + rec.t).toFixed(1)}s — ${y !== null ? `move it to y ${y}${variant ? ` in ${variant}` : ""} (onevideo fix)` : "move it clear of the text"} or show it at another moment`,
        at,
      });
    }
  }
  return out;
}

const boardHash = (project) => productsHash(project.root, ["plan/storyboard.json"]);
export function saveProbe(project, aspect, issues) {
  writeJson(join(project.paths.out, "qc", `probe.${aspect.replace(":", "x")}.json`), { storyboard: boardHash(project), aspect, issues });
}
export function storedProbes(project) {
  const dir = join(project.paths.out, "qc");
  if (!existsSync(dir)) return [];
  const hash = boardHash(project);
  return readdirSync(dir).filter((f) => /^probe\..+\.json$/.test(f)).map((f) => readJson(join(dir, f))).filter((p) => p.storyboard === hash).flatMap((p) => p.issues);
}
