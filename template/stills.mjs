// Stills for onevideo stills / preview: one bundle for the whole batch (the CLI re-bundles per
// still), and with `probe` the overlay and text boxes each frame logs (src/engine/probe.ts).
// Usage: node stills.mjs <job.json>; job = { entry, props, publicDir, scale, probe, frames: [{ frame, file }], out }.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
const serveUrl = await bundle({ entryPoint: resolve(import.meta.dirname, job.entry), publicDir: job.publicDir });
const inputProps = { ...JSON.parse(readFileSync(job.props, "utf8")), ...(job.probe ? { probe: true } : {}) };
const composition = await selectComposition({ serveUrl, id: job.composition ?? "OneVideo", inputProps });
const probes = [];
for (const { frame, file } of job.frames) {
  const logs = [];
  await renderStill({
    composition, serveUrl, inputProps, frame, output: file, imageFormat: "jpeg", scale: job.scale ?? 0.5, overwrite: true,
    onBrowserLog: (l) => { if (l.text.startsWith("ONEVIDEO_PROBE ")) logs.push(JSON.parse(l.text.slice(15))); },
  });
  // React may commit a frame more than once; the last log is the frame as captured.
  const last = new Map(logs.map((p) => [p.scene, p]));
  probes.push({ frame, file, scenes: [...last.values()] });
  console.log(`✓ ${file}`);
}
if (job.out) writeFileSync(job.out, JSON.stringify(probes));
