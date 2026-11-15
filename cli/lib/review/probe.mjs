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

// The nearest spot (in pixels; a move along one axis wins a tie) in hundredths of the frame where the
// overlay's measured box clears every measured line and the other stickers, stays out of the caption
// band and inside the frame. Returns the move { dx, dy } as frame fractions, or null.
function clearSpot(box, texts, others, { portrait, aspect }) {
  const band = portrait ? [0.74, 0.86] : [0.84, 0.96];
  let best = null;
  for (let i = -50; i <= 50; i++) for (let j = -80; j <= 80; j++) {
    if (!i && !j) continue;
    const dx = i / 100, dy = j / 100;
    const cost = Math.hypot(dx * aspect, dy) + (i && j ? 0.03 : 0);
    if (best && cost >= best.cost) continue;
    const b = [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy];
    if (b[0] < 0.02 || b[2] > 0.98 || b[1] < 0.02 || b[3] > 0.98 || (b[3] > band[0] && b[1] < band[1])) continue;
    if (texts.some((t) => meets(t.box, b)) || others.some((q) => meets(q, b))) continue;
    best = { cost, dx, dy };
  }
  return best;
}

// The keys that make that move. Probed stickers are placed by their centre, so x/y move with the box;
// one pinned to an element (`on`) moves by its `offset`, in layout units (1u = short edge / 1080).
function moveKeys(o, { dx, dy }, { width, height }) {
  const r2 = (v) => Math.round(v * 100) / 100;
  if (o.on === undefined) return { ...(dx ? { x: r2((o.x ?? 0.5) + dx) } : {}), ...(dy ? { y: r2((o.y ?? 0.5) + dy) } : {}) };
  const u = Math.min(width, height) / 1080, [ox, oy] = o.offset ?? [0, 0];
  return { offset: [Math.round(ox + (dx * width) / u), Math.round(oy + (dy * height) / u)] };
}

export function probeIssues(probes, timeline, { variant = null } = {}) {
  const portrait = timeline.height >= timeline.width * 1.5;
  const glyph = (b) => (b[3] - b[1]) ** 2 * (timeline.height / timeline.width);
  const byId = new Map(timeline.scenes.map((s) => [s.id, s]));
  const out = [], said = new Set();
  for (const p of probes) for (const rec of p.scenes ?? []) {
    const sc = byId.get(rec.scene);
    if (!sc) continue;
    // Scene text cut at the frame edge (a long title in a narrow frame, a label a push-in carries out).
    for (const t of rec.texts) {
      if (!t.cut?.length || said.has(`${sc.id}#cut#${t.text}`)) continue;
      said.add(`${sc.id}#cut#${t.text}`);
      const zoom = ((sc.shots ?? []).filter((s) => s.t <= rec.t).at(-1)?.zoom ?? 1) > 1.001;
      out.push({
        level: "warn", gate: "probe",
        msg: `scene "${sc.id}" text "${t.text}" runs off the ${t.cut.join(" and ")} edge at ${(sc.start + rec.t).toFixed(1)}s — ${zoom ? "keep the shot wider there, or make the text smaller or shorter" : "make the text smaller or shorter, or break the line"}`,
        at: { scene: sc.id, from: sc.start + rec.t, to: sc.start + rec.t, field: "props" },
      });
    }
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
      const others = rec.overlays.filter((q) => q.i !== i).map((q) => q.box);
      const move = clearSpot(box, rec.texts, others, { portrait, aspect: timeline.width / timeline.height });
      const set = move && moveKeys(o, move, timeline);
      const at = { scene: sc.id, from: sc.start + o.t, to: sc.start + Math.min(o.end, sc.duration), field: `overlays[${i}]` };
      const fix = !set ? undefined : variant
        ? { scene: sc.id, path: ["overlays", i, "aspects"], set: { [variant]: set }, add: true }
        : { scene: sc.id, path: ["overlays", i], set };
      const spot = set && Object.entries(set).map(([k, v]) => `${k} ${Array.isArray(v) ? `[${v.join(", ")}]` : v}`).join(", ");
      out.push({
        level: "warn", gate: "probe", fix,
        msg: `${name} covers ${fresh.map((t) => `"${t.text}"`).join(", ")} at ${(sc.start + rec.t).toFixed(1)}s — ${set ? `move it to ${spot}${variant ? ` in ${variant}` : ""} (onevideo fix)` : "move it clear of the text"} or show it at another moment`,
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
