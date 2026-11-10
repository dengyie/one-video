import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validate, validateNamed } from "../cli/lib/core/schema.mjs";
import { ROOT } from "./helpers.mjs";

test("validate: types, required, enum, ranges, patterns, oneOf and $ref", () => {
  const schema = {
    $defs: { id: { type: "string", pattern: "^[a-z]+$" } },
    type: "object", required: ["id", "n"], additionalProperties: false,
    properties: { id: { $ref: "#/$defs/id" }, n: { type: "integer", minimum: 1, maximum: 3 }, k: { enum: ["a", "b"] }, v: { oneOf: [{ type: "number" }, { const: false }] } },
  };
  assert.deepEqual(validate(schema, { id: "abc", n: 2, k: "a", v: false }), []);
  const errs = validate(schema, { id: "A1", n: 9, k: "z", v: "x", extra: 1 });
  assert.equal(errs.length, 5, errs.join("\n"));
  assert.ok(validate(schema, {}).some((e) => /id/.test(e)));
});

test("tts.loudness accepts a LUFS number or false", () => {
  const base = JSON.parse(readFileSync(join(ROOT, "examples", "spacex-ipo", "onevideo.json"), "utf8"));
  assert.deepEqual(validateNamed("project", { ...base, tts: { loudness: -16 } }), []);
  assert.deepEqual(validateNamed("project", { ...base, tts: { loudness: false } }), []);
  assert.ok(validateNamed("project", { ...base, tts: { loudness: 0 } }).length);
});

test("every pipeline stage points at an existing director and every style parses", () => {
  for (const f of readdirSync(join(ROOT, "pipelines"))) {
    const p = JSON.parse(readFileSync(join(ROOT, "pipelines", f), "utf8"));
    assert.ok(p.stages.length >= 5, f);
    for (const s of p.stages) assert.ok(existsSync(join(ROOT, s.director)), `${f}: ${s.director}`);
  }
  for (const f of readdirSync(join(ROOT, "styles"))) {
    const s = JSON.parse(readFileSync(join(ROOT, "styles", f), "utf8"));
    assert.ok(s.colors?.bg && s.colors?.accent && s.fonts?.body, f);
  }
});

test("every example passes the schemas and the pre-voice content gates", async () => {
  const { schemaGate, numbersGate, storyboardGate, captionGate } = await import("../cli/lib/review/gates.mjs");
  const dirs = readdirSync(join(ROOT, "examples"));
  assert.ok(dirs.includes("spacex-motion") && dirs.includes("spacex-ipo"));
  for (const name of dirs) {
    const read = (f) => JSON.parse(readFileSync(join(ROOT, "examples", name, f), "utf8"));
    const config = read("onevideo.json"), plan = (f) => read(join("plan", `${f}.json`));
    const [research, script, storyboard, assets] = ["research", "script", "storyboard", "assets"].map(plan);
    const errors = [
      ...schemaGate("project", config), ...schemaGate("research", research), ...schemaGate("script", script),
      ...schemaGate("storyboard", storyboard), ...schemaGate("assets", assets),
      ...numbersGate(script, research), ...captionGate(script, config), ...storyboardGate(storyboard, script, config, assets),
    ].filter((i) => i.level === "error");
    assert.deepEqual(errors, [], name);
    assert.equal(config.name, name);
  }
});
