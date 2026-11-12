// init / status / validate / approve
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { ONEVIDEO_ROOT, CONFIG_FILE, UserError, loadProject, pipelineDef, styleDef, writeJson, readJson, log } from "../lib/core/project.mjs";
import { stageStatus, approveStage } from "../lib/core/state.mjs";
import { checkProject, printIssues } from "../lib/review/check.mjs";
import { DIMENSIONS } from "../lib/timeline/index.mjs";

export async function init(args) {
  const dir = resolve(args._[0] ?? ".");
  if (existsSync(join(dir, CONFIG_FILE))) throw new UserError(`${dir} is already a OneVideo project`);
  if (existsSync(dir) && readdirSync(dir).filter((f) => !f.startsWith(".")).length && !args.force) throw new UserError(`${dir} is not empty (use --force to init anyway)`);
  if (args.aspect !== undefined && !DIMENSIONS[args.aspect]) throw new UserError(`--aspect ${args.aspect === true ? "needs a value" : `"${args.aspect}"`}: one of ${Object.keys(DIMENSIONS).join(", ")}`);
  const example = args.example;
  const exampleDir = example ? join(ONEVIDEO_ROOT, "examples", example) : null;
  if (exampleDir && !existsSync(exampleDir)) throw new UserError(`unknown example "${example}" (${readdirSync(join(ONEVIDEO_ROOT, "examples")).join(", ")})`);

  const base = exampleDir ? readJson(join(exampleDir, CONFIG_FILE)) : {};
  const pipeline = pipelineDef(args.pipeline ?? base.pipeline ?? "data-explainer");
  const config = {
    name: basename(dir),
    title: args.title ?? base.title ?? basename(dir),
    pipeline: pipeline.name,
    ...pipeline.defaults,
    ...base,
    ...(args.style ? { style: args.style } : {}),
    ...(args.aspect ? { aspect: args.aspect } : {}),
  };
  styleDef(config.style);
  mkdirSync(join(dir, "plan"), { recursive: true });
  for (const d of ["audio/lines", "music", "sfx", "assets"]) mkdirSync(join(dir, "public", d), { recursive: true });
  mkdirSync(join(dir, "out"), { recursive: true });
  if (exampleDir && existsSync(join(exampleDir, "plan"))) cpSync(join(exampleDir, "plan"), join(dir, "plan"), { recursive: true });
  if (exampleDir && existsSync(join(exampleDir, "public"))) cpSync(join(exampleDir, "public"), join(dir, "public"), { recursive: true });
  writeJson(join(dir, CONFIG_FILE), config);
  writeJson(join(dir, "state.json"), { stages: {} });
  writeFileSync(join(dir, ".gitignore"), "out/\npublic/audio/lines/\n*.tmp-*\n");
  log(`initialized ${dir}`);
  log(`  pipeline ${config.pipeline} · style ${config.style} · ${config.aspect}`);
  log(`next: cd ${dir} && onevideo status`);
}

export async function status() {
  const project = loadProject();
  const pipeline = pipelineDef(project.config.pipeline);
  const rows = stageStatus(project, pipeline);
  const icon = { done: "●", approved: "✔", "awaiting-approval": "◐", stale: "↻", pending: "○", optional: "◌" };
  log(`${project.config.title} — pipeline ${pipeline.name}`);
  for (const r of rows) log(`  ${icon[r.status]} ${r.id.padEnd(11)} ${r.status.padEnd(18)} ${(r.produces ?? []).join(", ")}`);
  const handoff = join(project.root, "plan", "handoff.md");
  if (existsSync(handoff)) log(`handoff: plan/handoff.md (${statSync(handoff).mtime.toLocaleString()}; what is locked and what the next round changes)`);
  const next = rows.find((r) => !["done", "approved", "optional"].includes(r.status));
  if (!next) return log("all stages complete");
  log("");
  log(`next stage: ${next.id}`);
  log(`  director: ${join(ONEVIDEO_ROOT, next.director)}`);
  if (next.command) log(`  command:  ${next.command}`);
  if (next.status === "awaiting-approval") log(`  review the products, then: onevideo approve ${next.id}`);
  if (next.status === "stale") log(`  ${next.reason ?? "products changed since approval; review again"}, then: onevideo approve ${next.id}`);
}

export async function validate(args) {
  const project = loadProject();
  const { issues, errors, warnings } = checkProject(project, { needTimings: Boolean(args.needTimings) });
  printIssues(issues);
  log(`${errors.length} error(s), ${warnings.length} warning(s)`);
  if (errors.length || (args.strict && warnings.length)) process.exitCode = 1;
}

export async function approve(args) {
  const id = args._[0];
  if (!id) throw new UserError("usage: onevideo approve <stage> [--note text]");
  const project = loadProject();
  const pipeline = pipelineDef(project.config.pipeline);
  const stage = pipeline.stages.find((s) => s.id === id);
  if (stage?.schema) {
    const { errors } = checkProject(project);
    const relevant = errors.filter((e) => e.gate.startsWith(`schema:${stage.schema}`) || (id === "script" && e.gate === "facts"));
    if (relevant.length) {
      printIssues(relevant);
      throw new UserError(`fix the errors above before approving "${id}"`);
    }
  }
  const rec = approveStage(project, pipeline, id, args.note);
  log(`approved ${id} (${rec.hash})`);
}
