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
  const { schemaGate, numbersGate, storyboardGate, captionGate, drawnGate } = await import("../cli/lib/review/gates.mjs");
  const dirs = readdirSync(join(ROOT, "examples"));
  assert.ok(dirs.includes("spacex-motion") && dirs.includes("spacex-ipo") && dirs.includes("graphics-demo") && dirs.includes("keeper"));
  for (const name of dirs) {
    const read = (f) => JSON.parse(readFileSync(join(ROOT, "examples", name, f), "utf8"));
    // A drawn example (pipeline graphics) has no asset plan at all.
    const has = (f) => existsSync(join(ROOT, "examples", name, f));
    const config = read("onevideo.json"), plan = (f) => read(join("plan", `${f}.json`));
    // Fiction (a drawn story) has no facts to source, so no research.json either.
    const [research, script, storyboard, assets] = ["research", "script", "storyboard", "assets"].map((f) => ((f === "assets" || f === "research") && !has(`plan/${f}.json`) ? null : plan(f)));
    const errors = [
      ...schemaGate("project", config), ...(research ? schemaGate("research", research) : []), ...schemaGate("script", script),
      ...schemaGate("storyboard", storyboard), ...(assets ? schemaGate("assets", assets) : []),
      ...numbersGate(script, research), ...captionGate(script, config), ...storyboardGate(storyboard, script, config, assets),
      ...drawnGate(storyboard, assets, config),
    ].filter((i) => i.level === "error");
    assert.deepEqual(errors, [], name);
    assert.equal(config.name, name);
  }
});

test("overlay aspects: per-frame x/y/size keyed by aspect", () => {
  const sb = JSON.parse(readFileSync(join(ROOT, "examples", "spacex-ipo", "plan", "storyboard.json"), "utf8"));
  const withOv = (aspects) => { const s = structuredClone(sb); s.scenes[0].overlays = [{ type: "stamp", text: "x", y: 0.3, aspects }]; return validateNamed("storyboard", s); };
  assert.deepEqual(withOv({ "9:16": { y: 0.2 } }), []);
  assert.ok(withOv({ tall: { y: 0.2 } }).some((e) => /does not match/.test(e)));
  assert.ok(withOv({ "9:16": {} }).some((e) => /needs ≥ 1/.test(e)));
  assert.deepEqual(withOv({ "9:16": { offset: [0, -120] } }), []);
  assert.ok(withOv({ "9:16": { t: 1 } }).some((e) => /unknown field "t"/.test(e)));
});
