// Every render is kept as out/versions/v<N>[-draft][-part].mp4 and logged in out/renders.json, so
// the director can compare a new cut with the last one instead of judging it from memory. The
// usual names (out/<name>.mp4, .draft.mp4, .part.mp4) point at the newest of each kind.
import { copyFileSync, existsSync, linkSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { UserError, readJson, writeJson } from "../core/project.mjs";

export const KEEP_VERSIONS = 8;
const logPath = (project) => join(project.paths.out, "renders.json");
export const readRenders = (project) => readJson(logPath(project), { renders: [] }).renders ?? [];

// --frames a-b, --scenes a,b (first to last named scene) or --from/--to seconds → an inclusive frame range.
export function frameRange(timeline, { scenes, from, to, frames } = {}) {
  const fps = timeline.fps, last = Math.round(timeline.duration * fps) - 1;
  if (frames !== undefined) {
    const m = /^(\d+)-(\d+)$/.exec(String(frames).trim());
    if (!m) throw new UserError(`--frames takes an inclusive range like 0-90, got ${frames === true ? "no value" : `"${frames}"`}`);
    // An end past the cut renders to its last frame.
    const a = Number(m[1]), b = Math.min(last, Number(m[2]));
    if (a > b) throw new UserError(`empty range: --frames ${frames} (the cut has frames 0-${last})`);
    return [a, b];
  }
  if (scenes) {
    const ids = String(scenes).split(",").map((x) => x.trim()).filter(Boolean);
    const hit = timeline.scenes.filter((s) => ids.includes(s.id));
    const unknown = ids.filter((id) => !timeline.scenes.some((s) => s.id === id));
    if (unknown.length) throw new UserError(`unknown scene(s): ${unknown.join(", ")} (have: ${timeline.scenes.map((s) => s.id).join(", ")})`);
    const a = Math.min(...hit.map((s) => s.from)), b = Math.max(...hit.map((s) => s.from + s.durationInFrames - 1));
    return [a, Math.min(b, last)];
  }
  if (from === undefined && to === undefined) return null;
  // A flag without its value parses as true, which Number() would turn into 1 second.
  for (const [k, x] of [["from", from], ["to", to]]) {
    if (x !== undefined && (typeof x === "boolean" || String(x).trim() === "" || !Number.isFinite(Number(x)))) throw new UserError(`--${k} takes seconds, got ${x === true ? "no value" : `"${x}"`}`);
  }
  const a = Math.max(0, Math.round(Number(from ?? 0) * fps)), b = Math.min(last, Math.round(Number(to ?? timeline.duration) * fps) - 1);
  if (!(b > a)) throw new UserError(`empty range: --from ${from ?? 0} --to ${to ?? timeline.duration}`);
  return [a, b];
}

// Local wall-clock time ("2026-11-07 09:30") for logs people read.
export const localStamp = (at) => { const d = new Date(at); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace("T", " "); };

export const timelineHash = (timeline) => createHash("sha256").update(JSON.stringify(timeline)).digest("hex").slice(0, 12);

export function versionFile(project, { draft, part }) {
  const n = readRenders(project).reduce((m, r) => Math.max(m, r.v), 0) + 1;
  return { v: n, file: join(project.paths.out, "versions", `v${n}${draft ? "-draft" : ""}${part ? "-part" : ""}.mp4`) };
}

// Point `alias` at the version (hard link, copy where links are not possible). The alias is
// removed first so the next render never writes through a shared inode into an old version.
function point(alias, file) {
  rmSync(alias, { force: true });
  try { linkSync(file, alias); } catch { copyFileSync(file, alias); }
}

export function recordRender(project, entry, { alias, keep = project.config.render?.keepVersions ?? KEEP_VERSIONS } = {}) {
  if (alias) point(alias, entry.file);
  const rel = (f) => relative(project.root, f);
  const renders = [...readRenders(project), { ...entry, file: rel(entry.file), ...(alias ? { alias: rel(alias) } : {}), bytes: statSync(entry.file).size }];
  // Old versions beyond `keep` lose their file but keep their log line.
  const live = renders.filter((r) => !r.pruned);
  for (const r of live.slice(0, Math.max(0, live.length - keep))) {
    rmSync(join(project.root, r.file), { force: true });
    r.pruned = true;
  }
  mkdirSync(project.paths.out, { recursive: true });
  writeJson(logPath(project), { renders });
  return renders.at(-1);
}

// A render made before versioning (out/<name>.mp4 that no logged version points at) becomes the
// first version instead of being overwritten by the next render, so it can still be compared.
// An alias the log already wrote is never legacy, even when it is a copy (no hard links) or its
// version was pruned since.
export function adoptLegacy(project, alias, { draft = false, part = false } = {}) {
  if (!alias || !existsSync(alias)) return null;
  const renders = readRenders(project), rel = relative(project.root, alias);
  if (renders.some((r) => r.alias === rel || (!r.pruned && sameFile(alias, join(project.root, r.file))))) return null;
  const { v, file } = versionFile(project, { draft, part });
  mkdirSync(join(project.paths.out, "versions"), { recursive: true });
  renameSync(alias, file);
  const at = statSync(file).mtime.toISOString();
  return recordRender(project, { v, file, at, draft, part, offset: 0, timeline: null, legacy: true, note: "imported: rendered before versioning" }, { alias: null });
}

// A video argument for sheet / look / qc: nothing (the newest render), "v3", "3", "prev" (the one
// before the newest), or a path. `offset` is where the file starts on the timeline (part renders).
export function resolveVideo(project, arg, fallback) {
  const renders = readRenders(project).filter((r) => !r.pruned && existsSync(join(project.root, r.file)));
  const hit = (r) => ({ file: join(project.root, r.file), offset: r.offset ?? 0, entry: r });
  if (arg === undefined || arg === true) {
    if (renders.length) return hit(renders.at(-1));
    return { file: fallback, offset: 0, entry: null };
  }
  const s = String(arg);
  if (s === "prev") {
    if (renders.length < 2) throw new UserError("no earlier render to compare with");
    return hit(renders.at(-2));
  }
  const m = /^v?(\d+)$/.exec(s);
  if (m) {
    const r = readRenders(project).find((x) => x.v === Number(m[1]));
    if (!r) throw new UserError(`no render v${m[1]} (see: onevideo versions)`);
    if (r.pruned || !existsSync(join(project.root, r.file))) throw new UserError(`render v${m[1]} was pruned (render.keepVersions keeps ${project.config.render?.keepVersions ?? KEEP_VERSIONS})`);
    return hit(r);
  }
  const file = resolve(s);
  const r = renders.find((x) => resolve(project.root, x.file) === file || (x.alias && resolve(project.root, x.alias) === file && sameFile(file, join(project.root, x.file))));
  return r ? hit(r) : { file, offset: 0, entry: null };
}

export function sameFile(a, b) {
  try { const x = statSync(a), y = statSync(b); return x.ino === y.ino && x.dev === y.dev; } catch { return false; }
}
