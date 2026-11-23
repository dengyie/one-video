import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeWav } from "../cli/lib/audio/wav.mjs";
import { estimatedTimings } from "../tests/helpers.mjs";

const project = process.argv[2];
if (!project) throw new Error("usage: node .github/prepare-silent-voice.mjs <copied example directory>");
const json = (...parts) => JSON.parse(readFileSync(join(project, ...parts), "utf8"));
const timings = await estimatedTimings(json("plan", "script.json"), json("onevideo.json"));
writeFileSync(join(project, "plan", "timings.json"), JSON.stringify(timings));
for (const { file, duration } of Object.values(timings.scenes)) {
  if (!file) continue;
  writeWav(join(project, "public", file), {
    channels: 1, sampleRate: timings.sampleRate,
    samples: new Int16Array(Math.round(duration * timings.sampleRate)),
  });
}
