#!/usr/bin/env node
// OneVideo CLI — a staged, gated pipeline for narrated data/documentary videos on Remotion.
import { parseArgs } from "./lib/core/args.mjs";
import { UserError } from "./lib/core/project.mjs";
import * as plan from "./commands/plan.mjs";
import * as media from "./commands/media.mjs";
import * as render from "./commands/render.mjs";
import * as library from "./commands/library.mjs";
import * as director from "./commands/director.mjs";
import { dispatch } from "./lib/core/worker.mjs";

const COMMANDS = {
  init: [plan.init, "init <dir> [--pipeline data-explainer] [--style midnight-data] [--aspect 16:9] [--title …] [--example spacex-motion|spacex-ipo|promo-demo]"],
  status: [plan.status, "status                       stage table + next director doc"],
  validate: [plan.validate, "validate [--strict]          schemas + pre-compose gates"],
  approve: [plan.approve, "approve <stage> [--note …]   human sign-off (hash-locked)"],
  tts: [media.tts, "tts [--sample] [--dry] [--force] [--only s1,s2]   sentence-level narration → plan/timings.json"],
  music: [media.music, "music [--preset ambient|pulse|documentary|bright] [--force]   procedural BGM + SFX"],
  timeline: [media.timeline, "timeline [--force]           compile plan/timeline.json"],
  assets: [media.assets, "assets search <query> [--provider …] [--kind video] | assets fetch [--only id] [--force]   (generate: AI image / video)"],
  capture: [media.capture, "capture <url> --id <asset> [--device phone|tablet|desktop] [--wait ms] [--click sel,…] [--rects name=sel,…] [--full] [--dark]   real UI screenshot → public/assets/<id>.png (+ named rects)"],
  screen: [media.screen, "screen <asset> [--at s] [--threshold 40]   corners of a dark device screen in footage → footage.props.screen"],
  depth: [media.depth, "depth [asset ids] [--step N] [--force]   depth maps for parallax / text-behind-subject (VM python + ONNX)"],
  decide: [media.decide, "decide <category> <subject> --selected X [--options a,b] [--reason …]"],
  render: [render.render, "render [--draft] [--scenes a,b | --from s --to s | --frames 0-90] [--aspect 9:16] [--note …] [--concurrency N] [--force]   → out/versions/vN (--aspect: out/<name>.9x16.mp4)"],
  versions: [render.versions, "versions [--json]            render log (out/renders.json): v, kind, range, timeline hash, note"],
  stills: [render.stills, "stills [--scene id,id] [--at 0.7|0.3,0.9] [--aspect 9:16]   JPEG per scene (and fraction) → out/stills/"],
  sheet: [director.sheet, "sheet [--fps 1] [--from s] [--to s] [--cols 6] [--video v3|prev|file] [--vs v2|prev]   contact sheets → out/qc/sheet-NN.jpg (compare-NN.jpg with --vs)"],
  look: [director.look, "look [--focus …] [--models a,b] [--fps N] [--from s] [--to s] [--video v3|prev|file]   vision-model review of the render → out/qc/look.json"],
  studio: [render.studio, "studio [--port 3000]         Remotion Studio on this project"],
  qc: [render.qc, "qc [--video v3|prev|file]    post-render review → plan/review.json"],
  publish: [render.publish, "publish [--force] [--stems] [--formats 9:16,1:1]  SRT/VTT, chapters, description (+ stems, + other sizes with their captions) → out/publish/ (needs approved review)"],
  stems: [render.stems, "stems [--only voice,music,sfx]  each sound group alone as WAV → out/publish/stems/"],
  build: [render.build, "build [--draft] [--concurrency N]   tts → music → media/depth → timeline → render → qc (then approve review, publish)"],
  lib: [library.lib, "lib list [--kind sfx|lottie] [--category c] | search <words> | import <candidates.json> | merge <catalog.json> | verify | recipe [<name> --id x --set k=v]"],
  handoff: [director.handoff, "handoff [--lock …] [--next …]   where the project stands → plan/handoff.md (read it when taking over)"],
  doctor: [render.doctor, "doctor                       environment check"],
};

function help() {
  console.log("onevideo <command> [options]\n");
  for (const [, usage] of Object.values(COMMANDS)) console.log(`  ${usage}`);
  console.log("\nDocs: SKILL.md · stages/*.md · references/*.md");
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") help();
else if (!COMMANDS[cmd]) {
  console.error(`unknown command "${cmd}"\n`);
  help();
  process.exitCode = 2;
} else {
  try {
    // render / build / depth / stills go to a worker when ONEVIDEO_WORKERS is set (--local: run here).
    if (!(await dispatch(cmd, rest))) await COMMANDS[cmd][0](parseArgs(rest, { booleans: ["force", "dry", "sample", "draft", "strict", "json", "stems", "full", "dark", "local"] }));
  } catch (e) {
    console.error(`✗ ${e instanceof UserError ? e.message : e.stack ?? e.message}`);
    process.exitCode = 1;
  }
}
