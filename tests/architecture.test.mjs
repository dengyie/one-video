import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers.mjs";
import { inspectClipPrompt, lookPrompt, pickTakePrompt, sceneLine } from "../cli/lib/prompts/index.mjs";

const LIB = join(ROOT, "cli", "lib");
// Domain → domains it may import (see references/architecture.md). assets ↔ generate is allowed
// at file level only: fetch calls generation, generated clips use assets/media.
const ALLOWED = {
  prompts: [], core: [], llm: ["core"], audio: ["core"], vision: ["core"], library: ["audio", "core"],
  captions: ["vision", "core"], voice: ["captions", "audio", "core"],
  generate: ["prompts", "llm", "vision", "assets", "core"], assets: ["generate", "prompts", "core"], archive: ["core"],
  timeline: ["captions", "vision", "library", "audio", "assets", "core"],
  review: ["timeline", "captions", "voice", "library", "core"], publish: ["review", "timeline", "captions", "voice", "core"],
};

const imports = (file) => [...readFileSync(file, "utf8").matchAll(/(?:from|import\()\s*["'](\.[^"']+)["']/g)].map((m) => m[1]);

test("lib domains only import the layers below them", () => {
  const dirs = readdirSync(LIB, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.deepEqual(dirs.sort(), Object.keys(ALLOWED).sort(), "a new domain needs a row in ALLOWED and in references/architecture.md");
  assert.deepEqual(readdirSync(LIB).filter((f) => f.endsWith(".mjs")), [], "no loose modules at cli/lib/");
  const bad = [];
  for (const d of dirs) for (const f of readdirSync(join(LIB, d)).filter((x) => x.endsWith(".mjs"))) {
    for (const spec of imports(join(LIB, d, f))) {
      const m = spec.match(/^\.\.\/([a-z]+)\//);
      if (spec.startsWith("../../")) { if (d !== "assets") bad.push(`${d}/${f} → ${spec}`); continue; }
      if (m && !ALLOWED[d].includes(m[1])) bad.push(`${d}/${f} → ${spec}`);
    }
  }
  // generate reaches into assets only for the media helpers, never the fetch barrel.
  for (const f of readdirSync(join(LIB, "generate"))) for (const spec of imports(join(LIB, "generate", f))) if (spec.startsWith("../assets/") && spec !== "../assets/media.mjs") bad.push(`generate/${f} → ${spec}`);
  assert.deepEqual(bad, []);
});

test("prompt builders are pure and fill every field", () => {
  const pick = pickTakePrompt({ count: 3, aspect: "9:16", prompt: "rocket at dawn", brief: "hook shot" });
  assert.match(pick, /^These are 3 takes .* framed 9:16\.\nBrief: rocket at dawn\nWhat the shot must do: hook shot\n/);
  assert.doesNotMatch(pickTakePrompt({ count: 2, aspect: "16:9", prompt: "x" }), /What the shot must do/);
  const ins = inspectClipPrompt({ cells: 12, t0: 0.25, step: 0.5, prompt: "p" });
  assert.match(ins, /12 cells; cell i shows t = 0\.25s \+ i×0\.5s\./);
  const look = lookPrompt({ sheet: { cells: 24, t0: 10, step: 1 }, scenes: "- a (title) 0.0–3.0s: ", focus: "captions" });
  assert.match(look, /cell i shows about t = 10\.5s \+ i×1s, and each cell is stamped with its exact time/);
  assert.match(lookPrompt({ sheet: { cells: 24, t0: 10, step: 1, times: [10.6] }, scenes: "" }), /moved a little off transitions/);
  assert.match(look, /Pay extra attention to: captions\./);
  assert.match(look, /within ~1s after the cell/);
  const line = sceneLine({ id: "v", type: "line-chart", start: 39.333, duration: 18, lines: [{ start: 2.25, text: "约3500亿" }], cues: { draw: 0.6, a: 8.122, b: 8.122, c: 0, d: null } });
  assert.equal(line, "- v (line-chart) 39.3–57.3s: [41.6s] 约3500亿 · reveals at 39.9, 47.5s");
  assert.doesNotMatch(sceneLine({ id: "t", type: "title", start: 0, duration: 3, lines: [] }), /reveals/);
  for (const s of [pick, ins, look]) assert.doesNotMatch(s, /undefined|\$\{/);
});
