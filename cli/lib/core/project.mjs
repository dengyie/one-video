import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ONEVIDEO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const CONFIG_FILE = "onevideo.json";

export class UserError extends Error {}

export function findProjectRoot(start = process.cwd()) {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new UserError(`not inside a OneVideo project (no ${CONFIG_FILE} found from ${start}); run: onevideo init <dir>`);
    dir = up;
  }
}

export function readJson(path, fallback) {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new UserError(`missing file: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new UserError(`invalid JSON in ${path}: ${e.message}`);
  }
}

// Write via temp file + rename so an interrupted run never leaves half a JSON file.
export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, path);
}

export function loadProject(start) {
  const root = findProjectRoot(start);
  const config = readJson(join(root, CONFIG_FILE));
  const p = (...xs) => join(root, ...xs);
  return {
    root,
    config,
    p,
    paths: {
      config: p(CONFIG_FILE),
      state: p("state.json"),
      research: p("plan", "research.json"),
      script: p("plan", "script.json"),
      storyboard: p("plan", "storyboard.json"),
      assets: p("plan", "assets.json"),
      timings: p("plan", "timings.json"),
      timeline: p("plan", "timeline.json"),
      review: p("plan", "review.json"),
      publish: p("plan", "publish.json"),
      audioDir: p("public", "audio"),
      linesDir: p("public", "audio", "lines"),
      musicDir: p("public", "music"),
      sfxDir: p("public", "sfx"),
      assetsDir: p("public", "assets"),
      out: p("out"),
    },
  };
}

export function pipelineDef(name) {
  const path = join(ONEVIDEO_ROOT, "pipelines", `${name}.json`);
  if (!existsSync(path)) throw new UserError(`unknown pipeline "${name}" (see ${join(ONEVIDEO_ROOT, "pipelines")})`);
  return readJson(path);
}

export function styleDef(name) {
  const path = join(ONEVIDEO_ROOT, "styles", `${name}.json`);
  if (!existsSync(path)) throw new UserError(`unknown style "${name}" (see ${join(ONEVIDEO_ROOT, "styles")})`);
  return readJson(path);
}

export const log = (...xs) => console.log(...xs);
export const warn = (...xs) => console.error("⚠", ...xs);
