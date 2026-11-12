// archive / restore: a project's lasting files on MangoDrive (see cli/lib/archive).
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { UserError, loadProject, log, warn } from "../lib/core/project.mjs";
import { archiveProject, driveConfig, restoreProject } from "../lib/archive/index.mjs";

export async function archive(args = {}) {
  if (!driveConfig()) throw new UserError("no archive configured: set ONEVIDEO_DRIVE_URL, ONEVIDEO_DRIVE_USER and ONEVIDEO_DRIVE_PASS (VM: /etc/onevideo/env)");
  const opts = { dry: Boolean(args.dry), prune: Boolean(args.prune), keep: Number(args.keep ?? 2), log, warn };
  if (!args.all) return report(await archiveProject(loadProject(), { ...opts, settle: Number(args.settle ?? 0) }), opts);
  // --all: every project directly under --in (default: here); one failing does not stop the rest.
  const base = resolve(args.in ?? ".");
  const dirs = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && existsSync(join(base, e.name, "onevideo.json"))).map((e) => e.name).sort();
  const failed = [];
  for (const d of dirs) {
    log(`── ${d}`);
    try { report(await archiveProject(loadProject(join(base, d)), { ...opts, settle: Number(args.settle ?? 600) }), opts); }
    catch (e) { warn(`${d}: ${e.message}`); failed.push(d); }
  }
  if (failed.length) throw new UserError(`archive failed for ${failed.length} of ${dirs.length} project(s): ${failed.join(", ")}`);
  log(`${dirs.length} project(s) archived from ${base}`);
}

function report(res, { dry }) {
  if (!dry) log(`${res.uploaded.length} uploaded and verified${res.pruned.length ? `, ${res.pruned.length} old render(s) removed here` : ""} → ${res.remote} (plan/archive.json)`);
}

export async function restore(args = {}) {
  const only = args._.slice(args._.length && !hasProject() ? 1 : 0);
  let root, name;
  if (hasProject()) ({ root, config: { name } } = loadProject());
  else {
    name = args._[0];
    if (!name) throw new UserError("usage: onevideo restore <project-name> [--into dir]   (outside a project) · onevideo restore [paths…] [--force]   (inside one)");
    root = resolve(args.into ?? name);
  }
  const res = await restoreProject({ root, name, only, force: Boolean(args.force), log });
  log(`${res.restored.length} file(s) restored from ${res.remote} → ${root}`);
}

function hasProject() {
  try { loadProject(); return true; } catch { return false; }
}
