// Picture gates, run on the compiled timeline before anything is rendered: layout (what a contact
// sheet would otherwise catch only after a full render), overlay refitting for other aspects, and
// material density. Overlay boxes are frame fractions; the camera, caption band, reveal rhythm and
// map labels come from shared/, the renderer's own models.
import { normalizeLicense } from "../core/license.mjs";
import { captionBand, seenBox } from "../../../shared/camera.mjs";
import { meets } from "../../../shared/boxes.mjs";
import { textEms } from "../../../shared/labels.mjs";
import { paceOf } from "../../../shared/reveal.mjs";
import { deviceCaptionSlot } from "../../../shared/safe-layout.mjs";
import { LAID_OUT_ZOOM, laidOut } from "../timeline/shots.mjs";
import { mapBoxes } from "./map-model.mjs";
import { assetRefs } from "./gates-plan.mjs";
import { STATIC_TYPES, issue } from "./issue.mjs";

// Layout, checked on the compiled timeline before anything is rendered: what a contact sheet
// would otherwise catch only after a full render. Boxes are frame fractions; overlays ride with
// the shot track, so the caption band is mapped into the scene's own coordinates at each moment.
// - an overlay over a spoken caption (error): the caption is unreadable or the sticker is cut;
// - an overlay partly out of frame, two stickers on top of each other, a sticker too small to read,
//   a keyword or sticker over a map pin or a pin, country or route label;
// - a shot pushed in so far that left-aligned or wide text leaves the frame.
const BOXED = new Set(["image", "icon", "lottie", "stamp"]);
const LEFT_TEXT = (sc, portrait) => (sc.type === "kinetic" && sc.props?.align === "left") || sc.type === "bullets" || (sc.type === "chapter" && !portrait);
const TEXT_TYPES = new Set([...STATIC_TYPES, "kinetic"]);
export const LAYOUT_DEFAULTS = { minSticker: 240, maxTextZoom: 1.25 };

function overlayBox(o, width, height) {
  if (o.on || (!BOXED.has(o.type) && o.type !== "word") || (o.x === undefined && o.y === undefined)) return null;
  const u = Math.min(width, height) / 1080;
  const x = o.x ?? 0.5, y = o.y ?? 0.5;
  // A keyword is one line at `size` px (CJK ≈ 1em per character, the rest ≈ 0.6em).
  if (o.type === "word") {
    const size = (o.size ?? 150) * u;
    const w = textEms(o.text ?? "") * size / width, h = size / height;
    return [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
  }
  // A stamp's box is its text at `size` px per character plus padding; the rest are size×size.
  const w = (o.type === "stamp" ? ((o.size ?? 72) * [...(o.text ?? "")].length + 80) : (o.size ?? 160)) * u / width;
  const h = (o.type === "stamp" ? (o.size ?? 72) * 1.5 : (o.size ?? 160)) * u / height;
  // An image or icon label hangs under it.
  const below = (o.type === "image" || o.type === "icon") && o.label ? 64 * u / height : 0;
  return [x - w / 2, y - h / 2, x + w / 2, y + h / 2 + below];
}
export function layoutGate(timeline, config) {
  const g = { ...LAYOUT_DEFAULTS, ...(config.gates ?? {}) };
  const { width, height } = timeline;
  const portrait = height >= width * 1.5;
  const pace = paceOf(timeline.theme?.motion?.pace);
  const out = [];
  const spoken = timeline.captions?.enabled !== false && timeline.captions?.style !== "none" ? timeline.captions.items ?? [] : [];
  for (const sc of timeline.scenes) {
    const slot = sc.type === "device" ? { ...deviceCaptionSlot(height, Math.min(width, height) / 1080, portrait), height } : undefined;
    const placed = [];
    const boxes = (sc.overlays ?? []).map((o) => overlayBox(o, width, height));
    for (const [i, o] of (sc.overlays ?? []).entries()) {
      const box = boxes[i];
      if (!box) continue;
      const at = { scene: sc.id, from: sc.start + o.t, to: sc.start + Math.min(o.end, sc.duration), field: `overlays[${i}]` };
      const name = `scene "${sc.id}" overlay ${i} (${o.type}${o.asset ? ` ${o.asset}` : ""}${o.text ? ` "${o.text}"` : ""})`;
      // The band is checked through the whole overlap: a push-in partway through can carry the overlay into it.
      const inBand = (c, bx = box) => {
        const a = Math.max(o.t, c.start - sc.start), b = Math.min(o.end, c.end - sc.start);
        for (let t = a; t < b; t += 0.25) if (meets(bx, captionBand(sc.shots, t, portrait, slot))) return true;
        return false;
      };
      const bandHit = (bx) => sc.captions !== false && spoken.find((c) => c.scene === sc.id && (slot || !c.top) && inBand(c, bx));
      // The part of the frame on screen through the overlay's whole life: a push-in crops its edges.
      const vis = seenBox(sc.shots, o.t, Math.min(o.end, sc.duration));
      const mapped = [];
      if (sc.type === "map") for (let t = o.t; t < o.end; t += 0.25) mapped.push(...mapBoxes(sc, t, width, height, pace));
      // Where to move it: pulled inside the frame on screen (0.02 margin), then up to the first place that
      // stays out of the caption band through every shot move and clear of every sticker up at the same
      // time and of the map's pins and labels. Heights are tried in hundredths, so the suggestion is a value to type in.
      const others = boxes.filter((b, k) => b && k !== i && sc.overlays[k].t < o.end && o.t < sc.overlays[k].end);
      const dx = box[0] < vis[0] + 0.02 ? vis[0] + 0.02 - box[0] : box[2] > vis[2] - 0.02 ? vis[2] - 0.02 - box[2] : 0;
      const dy0 = box[1] < vis[1] + 0.02 ? vis[1] + 0.02 - box[1] : box[3] > vis[3] - 0.02 ? vis[3] - 0.02 - box[3] : 0;
      const r2 = (v) => Math.round(v * 100) / 100;
      const spot = () => {
        if (box[2] - box[0] > vis[2] - vis[0] - 0.04) return null;
        const y0 = o.y ?? 0.5;
        for (let y = Math.floor((y0 + dy0) * 100 + 1e-6) / 100; box[1] + y - y0 >= vis[1] + 0.02 - 1e-9; y = r2(y - 0.01)) {
          const dy = y - y0;
          const bx = [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy];
          if (bandHit(bx) || others.some((b) => meets(b, bx)) || mapped.some((m) => meets(m.box, bx))) continue;
          const set = { ...(dx && { x: r2((o.x ?? 0.5) + dx) }), y: r2(y) };
          return { text: dx ? `move it to x ${set.x}, y ${set.y}` : `move it ${dy < 0 ? "up " : ""}to y ${set.y}`, fix: { scene: sc.id, path: ["overlays", i], set } };
        }
        return null;
      };
      const moved = spot();
      const cropped = box[0] < vis[0] - 0.01 || box[1] < vis[1] - 0.01 || box[2] > vis[2] + 0.01 || box[3] > vis[3] + 0.01;
      if (cropped) out.push(issue("warn", "layout", `${name} runs off the frame at x ${o.x ?? 0.5}, y ${o.y ?? 0.5}${box[0] < -0.01 || box[1] < -0.01 || box[2] > 1.01 || box[3] > 1.01 ? "" : " once the shot pushes in"} — ${moved?.text ?? "move it inward"}`, at, moved?.fix));
      if (o.type === "image" && (o.size ?? 160) < g.minSticker) out.push(issue("warn", "layout", `${name}: size ${o.size ?? 160} reads as a thumbnail — use ${g.minSticker}+ or make it a backdrop / photo-stack (gates.minSticker)`, at));
      const hit = bandHit(box);
      if (hit) out.push(issue("error", "layout", `${name} sits in the caption band while "${hit.text}" is spoken — ${moved?.text ?? `move it above y ${portrait ? 0.7 : 0.8}`} or to a side`, at, moved?.fix));
      for (const p of placed) if (p.o.t < o.end && o.t < p.o.end && meets(p.box, box)) out.push(issue("warn", "layout", `${name} overlaps overlay ${p.i} (${p.o.type}) — space them out or stagger their times`, at));
      if (sc.type === "map") {
        const hits = new Set(mapped.filter((m) => meets(m.box, box)).map((m) => m.what));
        if (hits.size) out.push(issue("warn", "layout", `${name} covers the map ${[...hits].join(", ")} — move it clear of the pins and labels or show it after the camera has moved on`, at));
      }
      placed.push({ i, o, box });
    }
    // Charts and cards are laid out to the frame's edges under a header that stays put: a push crops
    // their outer labels and slides their top under the header.
    if (laidOut(sc.type)) {
      const sh = (sc.shots ?? []).find((s) => (s.zoom ?? 1) > LAID_OUT_ZOOM);
      if (sh) out.push(issue("warn", "layout", `scene "${sc.id}" (${sc.type}) shot at ${sh.t}s pushes to zoom ${sh.zoom}; labels and cards near the edges leave the frame or slide under the header — check with onevideo stills, or reveal with cues instead (keep shots within ${LAID_OUT_ZOOM})`, { scene: sc.id, from: sc.start + sh.t, to: sc.start + sc.duration, field: "shots" }));
      continue;
    }
    if (!TEXT_TYPES.has(sc.type)) continue;
    for (const sh of sc.shots ?? []) {
      const z = sh.zoom ?? 1;
      if (z <= 1.02) continue;
      const left = (sh.x ?? 0.5) - 0.5 / z;
      if (LEFT_TEXT(sc, portrait) && left > 0.06) { out.push(issue("warn", "layout", `scene "${sc.id}" shot at ${sh.t}s (zoom ${z}) crops the left edge where its left-aligned text starts — centre the text (props.align) or keep the shot wider`, { scene: sc.id, from: sc.start + sh.t, to: sc.start + sc.duration, field: "shots" })); break; }
      if (z > g.maxTextZoom) { out.push(issue("warn", "layout", `scene "${sc.id}" shot at ${sh.t}s pushes text to zoom ${z} (max ${g.maxTextZoom}); wide lines leave the frame — check with onevideo stills (gates.maxTextZoom)`, { scene: sc.id, from: sc.start + sh.t, to: sc.start + sc.duration, field: "shots" })); break; }
    }
  }
  return out;
}

// A cut in another frame (--aspect 9:16) keeps the storyboard's fractional overlay spots, which can
// land in that frame's taller caption band or off its narrower edges: each such overlay takes the
// spot layoutGate suggests, in that cut's timeline only. A few passes, since one move can block another.
export function fitOverlays(timeline, config) {
  const moved = [];
  for (let pass = 0; pass < 3; pass++) {
    const fixes = layoutGate(timeline, config).filter((i) => i.fix?.path?.[0] === "overlays");
    if (!fixes.length) break;
    for (const { fix } of fixes) {
      const o = timeline.scenes.find((s) => s.id === fix.scene)?.overlays?.[fix.path[1]];
      if (!o || Object.entries(fix.set).every(([k, v]) => o[k] === v)) continue;
      Object.assign(o, fix.set);
      moved.push({ scene: fix.scene, i: fix.path[1], set: fix.set });
    }
  }
  return moved;
}

// Material density on the compiled timeline: distinct assets (photos, footage, captures, logos and
// AI-generated stills and clips alike) per minute, and text-only scenes held with nothing to look at.
// Charts, maps and timelines are their own evidence and are not flagged.
export const DENSITY_DEFAULTS = { minAssetsPerMinute: 4, goodAssetsPerMinute: 8, bareTextMax: 6 };
export function densityGate(timeline, assets, config) {
  const g = { ...DENSITY_DEFAULTS, ...(config.gates ?? {}) };
  // A drawn project has no media by design (the drawn gate holds it to that).
  if (config.drawn) return [];
  if (!g.minAssetsPerMinute && !g.goodAssetsPerMinute) return [];
  const generated = new Set((assets?.items ?? []).filter((a) => a.generate || normalizeLicense(a.license) === "generated").map((a) => a.id));
  const out = [];
  const minutes = Math.max(timeline.duration, 1) / 60;
  const refs = [...assetRefs(timeline.scenes)];
  const rate = refs.length / minutes;
  const ai = refs.filter((r) => generated.has(r)).length;
  const msg = `${refs.length} assets${ai ? ` (${ai} AI-generated)` : ""} in ${Math.round(timeline.duration)}s (${rate.toFixed(1)}/min)`;
  if (g.minAssetsPerMinute && rate < g.minAssetsPerMinute) out.push(issue("error", "density", `${msg}; min ${g.minAssetsPerMinute}/min — run onevideo assets suggest and put photos/footage behind the talk (gates.minAssetsPerMinute, 0 disables)`));
  else if (g.goodAssetsPerMinute && rate < g.goodAssetsPerMinute) out.push(issue("warn", "density", `${msg}; ${g.goodAssetsPerMinute}/min reads as well-sourced — onevideo assets suggest finds more (gates.goodAssetsPerMinute)`));
  for (const sc of timeline.scenes) {
    if (!TEXT_TYPES.has(sc.type) || sc.type === "sources" || sc.duration <= g.bareTextMax) continue;
    if (!assetRefs(sc).size) out.push(issue("warn", "density", `scene "${sc.id}" is ${sc.duration.toFixed(1)}s of ${sc.type} text with no photo, footage or logo — add a backdrop, photo-stack or image overlay`));
  }
  return out;
}
