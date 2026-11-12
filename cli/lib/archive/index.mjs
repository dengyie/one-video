// Archive domain: a project's lasting files go to MangoDrive, each one read back and checked against
// its sha256 before it counts; plan/archive.json records what is up there. Old renders can then be
// dropped here (--prune) and brought back with restore.
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, createWriteStream } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { readJson, writeJson } from "../core/project.mjs";
import { Drive, driveConfig, joinRemote, sha256File } from "./drive.mjs";

export { Drive, driveConfig, joinRemote, sha256File };
export const ARCHIVE = "plan/archive.json";

// What goes up: renders and their log, the publish kit, the plan, the recorded voice, source media
// and the config. What stays: anything derived again in minutes (frame sequences, stills, QC
// sheets, previews) and the sound library's files (public/sfx, public/music: licensed copies or
// synthesized), which are never uploaded anywhere.
const DIRS = ["out/versions", "out/publish", "plan", "public/assets", "public/audio"];
const FILES = ["onevideo.json", "state.json", "out/renders.json"];

export function archiveFiles(root, { name, library = process.env.ONEVIDEO_LIBRARY_EXT || "/srv/onevideo/library" } = {}) {
  const lib = existsSync(library) ? realpathSync(library) + sep : null;
  const out = [];
  const add = (rel) => {
    const abs = join(root, rel);
    // A file that resolves into the sound library is a licensed copy: it stays.
    if (lib && lstatSync(abs).isSymbolicLink() && realpathSync(abs).startsWith(lib)) return;
    if (rel !== ARCHIVE) out.push(rel.split(sep).join("/"));
  };
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name.endsWith(".frames") || e.name.endsWith(".part")) continue;
      const r = join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else if (e.isFile() || e.isSymbolicLink()) add(r);
    }
  };
  for (const d of DIRS) if (existsSync(join(root, d))) walk(d);
  for (const f of FILES) if (existsSync(join(root, f))) add(f);
  // Other frame sizes of the cut (out/<name>.9x16.mp4); the main out/<name>.mp4 is a link to its version.
  if (name && existsSync(join(root, "out"))) for (const f of readdirSync(join(root, "out"))) if (f.startsWith(`${name}.`) && /\.\d+x\d+\.mp4$/.test(f)) add(join("out", f));
  return out.sort();
}

export const loadArchive = (root) => readJson(join(root, ARCHIVE), { remote: null, files: {} });

// Files new or changed since they were last uploaded (size + mtime unchanged = same file, not rehashed).
export function changedFiles(root, files, record) {
  return files.filter((rel) => {
    const r = record.files[rel];
    if (!r) return true;
    const st = statSync(join(root, rel));
    return r.size !== st.size || r.mtimeMs !== Math.round(st.mtimeMs);
  });
}

// out/versions/vN.mp4 older than the newest `keep`: what --prune may drop locally.
export function prunable(files, keep = 2) {
  const versions = files.map((f) => [f, /^out\/versions\/v(\d+)\.mp4$/.exec(f)?.[1]]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  return versions.slice(keep).map(([f]) => f);
}

// Upload what changed, verify each by reading it back, record it; then optionally prune old renders.
export async function archiveProject(project, { dry = false, prune = false, keep = 2, drive, log = () => {}, warn = () => {} } = {}) {
  const cfg = drive?.cfg ?? driveConfig();
  if (!cfg) throw new Error("no archive configured: set ONEVIDEO_DRIVE_URL, ONEVIDEO_DRIVE_USER, ONEVIDEO_DRIVE_PASS (in /etc/onevideo/env)");
  const d = drive ?? new Drive(cfg);
  const { root } = project;
  const remote = joinRemote(cfg.root, project.config.name);
  const record = loadArchive(root);
  if (record.remote && record.remote !== remote) warn(`plan/archive.json was written for ${record.remote}; now archiving to ${remote}`);
  record.remote = remote;
  const files = archiveFiles(root, { name: project.config.name });
  const todo = changedFiles(root, files, record);
  const bytes = todo.reduce((s, f) => s + statSync(join(root, f)).size, 0);
  log(`${todo.length} of ${files.length} file(s) to upload (${(bytes / 1e6).toFixed(1)} MB) → ${remote}`);
  if (dry) {
    for (const f of todo) log(`  ${f}`);
    if (prune) for (const f of prunable(files, keep)) log(`  prune ${f}`);
    return { uploaded: [], pruned: [], todo };
  }
  const uploaded = [];
  for (const rel of todo) {
    const abs = join(root, rel);
    const st = statSync(abs);
    const local = await sha256File(abs);
    await d.put(joinRemote(remote, rel), abs);
    const back = await d.download(joinRemote(remote, rel));
    if (back.sha256 !== local.sha256) throw new Error(`${rel}: read-back sha256 does not match (${back.size} vs ${local.size} bytes); not recorded, run archive again`);
    record.files[rel] = { sha256: local.sha256, size: local.size, mtimeMs: Math.round(st.mtimeMs), at: new Date().toISOString() };
    record.at = new Date().toISOString();
    writeJson(join(root, ARCHIVE), record);
    uploaded.push(rel);
    log(`✓ ${rel} (${(local.size / 1e6).toFixed(1)} MB, sha256 ${local.sha256.slice(0, 12)} verified)`);
  }
  const pruned = [];
  if (prune) {
    for (const rel of prunable(files, keep)) {
      const r = record.files[rel];
      if (!r || changedFiles(root, [rel], record).length) { warn(`${rel}: not archived as it is now; kept`); continue; }
      rmSync(join(root, rel));
      record.files[rel] = { ...r, pruned: true };
      pruned.push(rel);
      log(`- ${rel} removed here (on the drive; onevideo restore brings it back)`);
    }
  }
  record.at = new Date().toISOString();
  writeJson(join(root, ARCHIVE), record);
  // The record itself goes up last, so a fresh machine can restore from the drive alone.
  await d.put(joinRemote(remote, ARCHIVE), join(root, ARCHIVE));
  return { uploaded, pruned, todo, remote };
}

// Download one remote file to a local path through a .part file, checking its sha256 when known.
async function fetchTo(d, remotePath, abs, sha256) {
  mkdirSync(dirname(abs), { recursive: true });
  const part = `${abs}.part`;
  const got = await d.download(remotePath, createWriteStream(part));
  if (sha256 && got.sha256 !== sha256) { rmSync(part, { force: true }); throw new Error(`${relative(process.cwd(), abs)}: sha256 does not match the archive record`); }
  renameSync(part, abs);
  return got;
}

// Bring archived files back: into a project (what plan/archive.json lists and is missing here, or
// `only` paths/prefixes), or a whole project from the drive into `into` when there is none here.
export async function restoreProject({ root, name, only = [], force = false, drive, log = () => {} }) {
  const cfg = drive?.cfg ?? driveConfig();
  if (!cfg) throw new Error("no archive configured: set ONEVIDEO_DRIVE_URL, ONEVIDEO_DRIVE_USER, ONEVIDEO_DRIVE_PASS");
  const d = drive ?? new Drive(cfg);
  const wanted = (rel) => !only.length || only.some((o) => rel === o || rel.startsWith(o.replace(/\/?$/, "/")));
  let record = existsSync(join(root, ARCHIVE)) ? loadArchive(root) : null;
  const remote = record?.remote ?? joinRemote(cfg.root, name);
  if (!record) {
    log(`no ${ARCHIVE} here; reading ${remote}`);
    mkdirSync(join(root, "plan"), { recursive: true });
    await fetchTo(d, joinRemote(remote, ARCHIVE), join(root, ARCHIVE));
    record = loadArchive(root);
  }
  const restored = [];
  for (const [rel, r] of Object.entries(record.files)) {
    const abs = join(root, rel);
    if (!wanted(rel) || (existsSync(abs) && !force)) continue;
    await fetchTo(d, joinRemote(remote, rel), abs, r.sha256);
    const { pruned: _p, ...kept } = r;
    record.files[rel] = { ...kept, mtimeMs: Math.round(statSync(abs).mtimeMs) };
    restored.push(rel);
    log(`✓ ${rel}`);
  }
  writeJson(join(root, ARCHIVE), record);
  return { restored, remote };
}
