import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "../core/project.mjs";
import { countFrames, depthPath, framesDir, lumaPath } from "./media.mjs";

const OPAQUE_TYPES = new Set(["media", "focus", "split", "footage", "parallax", "match-cut"]);

export function collectAssetRefs(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => collectAssetRefs(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if ((k === "asset" || k === "avatar" || k === "logo") && typeof x === "string") out.add(x);
      else collectAssetRefs(x, out);
    }
  }
  return out;
}

export function credit(a) {
  if (a.license === "generated") return null;
  return [a.title, a.author, a.license].filter(Boolean).join(" · ");
}

export function compileSceneVisuals(scene, props, overlays, { assetById, usedAssets, root, errors, warnings }) {
  const refs = collectAssetRefs([props, overlays]);
  if (scene.backdrop) refs.add(scene.backdrop.asset);
  for (const id of refs) {
    const a = assetById.get(id);
    if (!a) { errors.push(`scene "${scene.id}" references unknown asset "${id}"`); continue; }
    if (!a.file) { errors.push(`asset "${id}" not fetched yet; run: onevideo assets fetch`); continue; }
    if (root && !existsSync(join(root, "public", a.file))) errors.push(`asset "${id}" file missing: public/${a.file}; run: onevideo assets fetch`);
    usedAssets[id] = { src: a.file, kind: a.kind, credit: credit(a), ...(a.license === "generated" && { generated: true }) };
    // A full-page capture is this many of its viewport tall (what a scrolling screen slides over).
    const vp = a.capture?.full && a.capture.viewport;
    if (vp && a.width && a.height) usedAssets[id].pages = Math.round(a.height / a.width / (vp[1] / vp[0]) * 1000) / 1000;
    if (root && existsSync(join(root, "public", depthPath(a)))) {
      usedAssets[id].depth = depthPath(a);
      const meta = join(root, "public", depthPath(a), "meta.json");
      if (a.kind === "video" && existsSync(meta)) { const m = readJson(meta); Object.assign(usedAssets[id], { depthStep: m.step, depthFrames: m.frames }); }
    }
    if (root && existsSync(join(root, "public", lumaPath(a)))) usedAssets[id].luma = lumaPath(a);
    if (a.kind === "video" && root) {
      const frames = countFrames(join(root, "public", framesDir(a.file)));
      if (frames) Object.assign(usedAssets[id], { seq: framesDir(a.file), frames, fps: 30 });
      else warnings.push(`asset "${id}": no frame sequence, falls back to <OffthreadVideo> (needs memory); run: onevideo render (extracts it)`);
    }
  }
  return {
    opaque: Boolean(scene.backdrop) || OPAQUE_TYPES.has(scene.type),
    header: scene.header ?? null,
    background: scene.background ?? null,
    backdrop: scene.backdrop ? { dim: 0.62, blur: 0, motion: "in", startFrom: 0, ...scene.backdrop } : null,
  };
}
