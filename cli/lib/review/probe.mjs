// Stickers over scene text, from the boxes the stills probe measured on screen (template/stills.mjs,
// template/src/engine/probe.ts): titles, chart labels and card text the layout gate cannot model.
// The last stills run of each frame is kept (out/qc/probe.<aspect>.json) for onevideo fix, as long as
// the storyboard it measured is still the one on disk.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "../core/project.mjs";
import { productsHash } from "../core/state.mjs";
import { area, meets, overlap as cut } from "../../../shared/boxes.mjs";
// A sticker counts as covering a line once it hides about a third of one character (a glyph is
// roughly line-height square); a graze along an edge reads fine.
export const COVER_GLYPH = 0.35;
const STICKERS = new Set(["image", "icon", "lottie", "stamp", "word"]);

export function overlayProbeFrames(scene, fps, existing) {
  const frames = new Set(existing);
  const added = new Set();
  for (const o of scene.overlays ?? []) {
    if (!STICKERS.has(o.type)) continue;
    const end = Math.min(o.end, scene.duration);
    if (end <= o.t) continue;
    const active = end - o.t;
    for (const at of [o.t + Math.min(0.3, active / 2), o.t + active / 2]) {
      const frame = Math.min(scene.durationInFrames - 1, Math.round(at * fps)) + scene.from;
      if (!frames.has(frame)) { frames.add(frame); added.add(frame); }
    }
  }
  return [...added].sort((a, b) => a - b);
}

// The nearest spot (in pixels; a move along one axis wins a tie) in hundredths of the frame where the
// overlay's measured box clears every measured line and the other stickers, stays out of the caption
// band and inside the frame. Returns the move { dx, dy } as frame fractions, or null.
function clearSpot(samples, { portrait, aspect }) {
  const band = portrait ? [0.74, 0.86] : [0.84, 0.96];
  let best = null;
  for (let i = -50; i <= 50; i++) for (let j = -80; j <= 80; j++) {
    if (!i && !j) continue;
    const dx = i / 100, dy = j / 100;
    const cost = Math.hypot(dx * aspect, dy) + (i && j ? 0.03 : 0);
    if (best && cost >= best.cost) continue;
    if (samples.some(({ box, texts, others }) => {
      const b = [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy];
      return b[0] < 0.02 || b[2] > 0.98 || b[1] < 0.02 || b[3] > 0.98 || (b[3] > band[0] && b[1] < band[1])
        || texts.some((t) => meets(t.box, b)) || others.some((q) => meets(q, b));
    })) continue;
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
  const placements = new Map();
  for (const p of probes) for (const rec of p.scenes ?? []) for (const { i, box } of rec.overlays) {
    const key = JSON.stringify([rec.scene, i]);
    if (!placements.has(key)) placements.set(key, []);
    placements.get(key).push({ box, texts: rec.texts, others: rec.overlays.filter((q) => q.i !== i).map((q) => q.box) });
  }
  const out = [], said = new Set();
  for (const p of probes) for (const rec of p.scenes ?? []) {
    const sc = byId.get(rec.scene);
    if (!sc) continue;
    for (const text of rec.captionClashes ?? []) {
      const key = `${sc.id}#caption#${text}`;
      if (said.has(key)) continue;
      said.add(key);
      const t = sc.start + rec.t;
      out.push({
        level: "warn", gate: "probe",
        msg: `scene "${sc.id}" caption "${text}" covers a protected subject at ${t.toFixed(1)}s`,
        at: { scene: sc.id, from: t, to: t, field: "captions" },
      });
    }
    // Scene text cut at the frame edge (a long title in a narrow frame, a label a push-in carries out).
    // Not while the camera travels (a shot move, a canvas or map flight: `moving`): text it carries
    // across the edge is on its way in or out; a still where the camera holds reports it.
    for (const t of rec.moving ? [] : rec.texts) {
      if (!t.cut?.length || said.has(`${sc.id}#cut#${t.text}`)) continue;
      said.add(`${sc.id}#cut#${t.text}`);
      const zoom = ((sc.shots ?? []).filter((s) => s.t <= rec.t).at(-1)?.zoom ?? 1) > 1.001;
      out.push({
        level: "warn", gate: "probe",
        msg: `scene "${sc.id}" text "${t.text}" runs off the ${t.cut.join(" and ")} edge at ${(sc.start + rec.t).toFixed(1)}s — ${zoom ? "keep the shot wider there, or make the text smaller or shorter" : "make the text smaller or shorter, or break the line"}`,
        at: { scene: sc.id, from: sc.start + rec.t, to: sc.start + rec.t, field: "props" },
      });
    }
    // Scene text on scene text (a label plate stacked on another label, crowded chart labels): a solid
    // line hidden over a third of a glyph by another. Hit-tested when the probe measured it (`over`: what
    // is drawn on top, plates included), else the inked middles of the boxes, as far as their own
    // clipping lets them show. The same words drawn twice (an echo, an outline layer) are not a clash.
    const solid = (t) => (t.a ?? 1) >= 0.8 && !(t.v && !t.v.length);
    const inked = rec.texts.map((t) => {
      if (!solid(t)) return null;
      const ink = (t.box[3] - t.box[1]) * 0.2, v = t.v ?? t.box;
      const b = [Math.max(t.box[0], v[0]), Math.max(t.box[1] + ink, v[1]), Math.min(t.box[2], v[2]), Math.min(t.box[3] - ink, v[3])];
      return area(b) > 0 ? b : null;
    });
    const clashes = [];
    rec.texts.forEach((under, k) => {
      if (rec.hit) {
        for (const { t: j, area: a } of under.over ?? []) if (rec.texts[j]) clashes.push({ top: rec.texts[j], under, a, drawn: true });
      } else for (let j = k + 1; j < rec.texts.length; j++) if (inked[j] && inked[k]) clashes.push({ top: rec.texts[j], under, a: cut(inked[j], inked[k]) });
    });
    for (const { top, under, a, drawn } of clashes) {
      if (top.text === under.text || !solid(top) || !solid(under)) continue;
      if (a <= COVER_GLYPH * Math.min(glyph(under.box), area(under.box))) continue;
      const key = `${sc.id}#text#${[top.text, under.text].sort().join("\n")}`;
      if (said.has(key)) continue;
      said.add(key);
      out.push({
        level: "warn", gate: "probe",
        msg: `scene "${sc.id}" text ${drawn ? `"${top.text}" covers "${under.text}"` : `"${under.text}" and "${top.text}" overlap`} at ${(sc.start + rec.t).toFixed(1)}s — move one of them, shorten it, or show them at different moments`,
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
      const move = clearSpot(placements.get(JSON.stringify([sc.id, i])), { portrait, aspect: timeline.width / timeline.height });
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
