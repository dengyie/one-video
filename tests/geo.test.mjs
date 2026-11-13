import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TEMPLATE_DIR } from "../cli/lib/core/ffmpeg.mjs";
import { countryCentroid } from "../cli/lib/library/geo.mjs";

const mods = join(TEMPLATE_DIR, "node_modules");

test("country centroids match d3 geoCentroid on the template's world-atlas", { skip: !existsSync(join(mods, "world-atlas")) && "template dependencies not installed" }, async () => {
  const { geoCentroid } = await import(pathToFileURL(join(mods, "d3-geo", "dist", "d3-geo.mjs")).href);
  const { feature } = await import(pathToFileURL(join(mods, "topojson-client", "dist", "topojson-client.js")).href);
  // First feature per id wins, as Map.tsx's feats.find does.
  const load = (d) => {
    const t = JSON.parse(readFileSync(join(mods, "world-atlas", `countries-${d}.json`), "utf8"));
    const m = new Map();
    for (const f of feature(t, t.objects.countries).features) if (f.id && !m.has(String(f.id))) m.set(String(f.id), geoCentroid(f).map((v) => Math.round(v * 100) / 100));
    return m;
  };
  const s = load("110m"), want = {};
  for (const [id, c] of load("50m")) { const c1 = s.get(id); want[id] = !c1 ? [...c, null] : Math.hypot(c1[0] - c[0], c1[1] - c[1]) > 0.5 ? [...c, ...c1] : c; }
  const file = new URL("../cli/lib/library/country-centroids.json", import.meta.url);
  if (process.env.ONEVIDEO_WRITE_CENTROIDS) writeFileSync(file, JSON.stringify(want));
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), want);
});

test("countryCentroid: 50m by default, 110m variant or absence by detail", () => {
  assert.deepEqual(countryCentroid("840"), [-103.63, 44.74]);
  assert.deepEqual(countryCentroid("702"), [103.82, 1.36]);
  assert.equal(countryCentroid("702", "110m"), null);
  assert.deepEqual(countryCentroid("152", "110m"), [-71.18, -37.31]);
  assert.equal(countryCentroid("999"), null);
});
