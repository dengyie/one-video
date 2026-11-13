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

test("mapBoxes places pins where d3's mercator and orthographic projections put them", { skip: !existsSync(join(mods, "d3-geo")) && "template dependencies not installed" }, async () => {
  const { geoMercator, geoOrthographic, geoInterpolate } = await import(pathToFileURL(join(mods, "d3-geo", "dist", "d3-geo.mjs")).href);
  const { mapBoxes } = await import("../cli/lib/review/gates.mjs");
  const [W, H] = [1920, 1080], u = 1;
  const pins = [{ lon: 103.82, lat: 1.35 }, { lon: 139.7, lat: 35.7 }, { lon: -74, lat: 40.7 }];
  const route = { from: [103.8, 1.4], to: [-122.4, 37.8], label: "航线" };
  for (const [mode, view, proj] of [
    ["map", { center: [110, 20], zoom: 2 }, geoMercator().rotate([-110, 0, 0]).center([0, 20]).scale((W / (2 * Math.PI)) * 2).translate([W / 2, H * 0.54])],
    ["globe", { center: [120, 25], zoom: 1.2 }, geoOrthographic().rotate([-120, -25, 0]).scale(Math.min(W, H) * 0.42 * 1.2).translate([W / 2, H / 2])],
  ]) {
    const sc = { type: "map", duration: 10, cues: {}, props: { mode, views: [view], pins, routes: [route] } };
    const got = mapBoxes(sc, 9, W, H).filter((m) => m.what === "pin").map((m) => [((m.box[0] + m.box[2]) / 2) * W, ((m.box[1] + m.box[3]) / 2) * H]);
    // New York is on the far side of the globe and has no pin there.
    const want = pins.slice(0, mode === "globe" ? 2 : 3).map((p) => proj([p.lon, p.lat]));
    assert.equal(got.length, want.length, mode);
    got.forEach((g, i) => assert.ok(Math.hypot(g[0] - want[i][0], g[1] - want[i][1]) < 0.5, `${mode} pin ${i}: ${g} vs ${want[i]}`));
    const lab = mapBoxes(sc, 9, W, H).find((m) => m.what === 'label "航线"');
    const mid = proj(geoInterpolate(route.from, route.to)(0.5));
    assert.ok(Math.abs(((lab.box[0] + lab.box[2]) / 2) * W - mid[0]) < 0.5 && Math.abs(((lab.box[1] + lab.box[3]) / 2) * H - (mid[1] - 40 * u)) < 0.5, mode);
  }
});
