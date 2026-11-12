// render / stills / studio / qc / publish / build / doctor
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { availableParallelism, tmpdir, totalmem } from "node:os";
import { execFileSync } from "node:child_process";
import { UserError, loadProject, pipelineDef, readJson, writeJson, log, warn, ONEVIDEO_ROOT } from "../lib/core/project.mjs";
import { archiveProject, driveConfig } from "../lib/archive/index.mjs";
import { productsHash, reviewSubject, stageStatus } from "../lib/core/state.mjs";
import { checkProject, printIssues } from "../lib/review/check.mjs";
import { REMOTION_BIN, TEMPLATE_DIR, requireRemotion, run, ffmpeg } from "../lib/core/ffmpeg.mjs";
import { runQc } from "../lib/vision/qc.mjs";
import { DIMENSIONS } from "../lib/timeline/index.mjs";
import { buildPublishKit, stemGroups } from "../lib/publish/kit.mjs";
import { toSrt, toVtt } from "../lib/captions/index.mjs";
import { resolveApiKey, trustedKeyHost } from "../lib/core/http.mjs";
import { runTts, ttsConfig } from "../lib/voice/tts.mjs";
import { timingsGate } from "../lib/review/gates.mjs";
import * as media from "./media.mjs";
import { assetFileExists, clipFrames, countFrames, framesDir } from "../lib/assets/index.mjs";
import { IMAGE_DEFAULTS, VIDEO_DEFAULTS } from "../lib/generate/index.mjs";
import { llmConfig } from "../lib/llm/client.mjs";
import { ensureBeats } from "../lib/audio/beats.mjs";
import { writeImageSheets } from "../lib/vision/sheet.mjs";
import { workerHosts } from "../lib/core/worker.mjs";
import { adoptLegacy, frameRange, localStamp, readRenders, recordRender, resolveVideo, sameFile, timelineHash, versionFile } from "../lib/publish/renders.mjs";

const ENTRY = "src/index.ts";
const COMPOSITION = "OneVideo";

// Render tabs when nothing is set: one per core, at most 4, and one per ~1.5 GB of RAM so a
// 2 GB node does not run out of memory.
export const autoConcurrency = (cpus = availableParallelism(), mem = totalmem()) =>
  Math.max(1, Math.min(4, cpus, Math.floor(mem / 1.5e9)));

export const videoPath = (project) => join(project.paths.out, `${project.config.name}.mp4`);

// Projects fetched before frame sequences existed get them on first render.
async function ensureClipFrames(project) {
  if (!existsSync(project.paths.assets)) return;
  for (const a of readJson(project.paths.assets).items ?? []) {
    if (a.kind !== "video" || !a.file) continue;
    const mp4 = project.p("public", a.file), dir = project.p("public", framesDir(a.file));
    if (!existsSync(mp4) || countFrames(dir)) continue;
    log(`extracting frames: ${a.id} → public/${framesDir(a.file)}/`);
    await clipFrames(mp4, dir);
  }
}

// Beat grid for shot snapping; synthesized music writes its own, a provided track is analysed once.
async function ensureMusicBeats(project) {
  const m = project.config.music;
  if (m?.enabled === false) return;
  const b = await ensureBeats(project.root, { src: m?.file ?? "music/bgm.wav" });
  if (b) log(`beats: ~${b.bpm} BPM (${b.source})`);
}

// Compile + gate the timeline; renders never start from a stale or failing plan.
function freshTimeline(project, { force = false } = {}) {
  const res = checkProject(project, { needTimings: true });
  printIssues(res.issues);
  if (res.errors.length && !force) throw new UserError(`${res.errors.length} pre-compose error(s); fix them before rendering (or --force)`);
  writeJson(project.paths.timeline, res.timeline);
  return res.timeline;
}

// The same cut in another frame (--aspect 9:16 for a vertical feed, 1:1, 4:5): layouts are in units
// of the short edge, so the plan compiles as is into its own timeline (plan/timeline.9x16.json) and
// renders beside the main cut (out/<name>.9x16.mp4) without touching its versions.
export const aspectTag = (aspect) => String(aspect).replace(":", "x");
export function withAspect(project, aspect) {
  if (!aspect || aspect === true) return project;
  if (!DIMENSIONS[aspect]) throw new UserError(`--aspect "${aspect}": one of ${Object.keys(DIMENSIONS).join(", ")}`);
  if (aspect === (project.config.aspect ?? "16:9") && !project.config.width) return project;
  const { width: _w, height: _h, ...config } = project.config;
  const tag = aspectTag(aspect);
  return {
    ...project, config: { ...config, aspect }, aspect,
    paths: { ...project.paths, timeline: project.p("plan", `timeline.${tag}.json`), timings: project.p("plan", `timings.${tag}.json`), audioDir: project.p("public", "audio", tag), audioRel: `audio/${tag}` },
  };
}

// Captions wrap shorter in a narrow frame, so a variant has its own caption timings: the same voice
// audio (cached by content in public/audio/lines, no new synthesis in scene unit) with the lines
// placed again on its pauses.
async function ensureAspectTimings(project) {
  if (!project.aspect || !existsSync(project.paths.script)) return;
  const script = readJson(project.paths.script);
  const timings = existsSync(project.paths.timings) ? readJson(project.paths.timings) : null;
  if (timings && !timingsGate(script, timings, project.config).length) return;
  log(`caption timings for ${project.aspect} → ${relative(project.root, project.paths.timings)}`);
  writeJson(project.paths.timings, await runTts(project, script));
}

function commonFlags(project) {
  return [`--props=${project.paths.timeline}`, `--public-dir=${project.p("public")}`];
}

export async function render(args) {
  requireRemotion();
  const project = withAspect(loadProject(), args.aspect);
  await ensureClipFrames(project);
  await ensureMusicBeats(project);
  await ensureAspectTimings(project);
  const tl = freshTimeline(project, { force: Boolean(args.force) });
  mkdirSync(join(project.paths.out, "versions"), { recursive: true });
  const draft = Boolean(args.draft);
  // A part (--scenes / --from / --to / --frames) is the 15-second sample: iterate on one stretch
  // without paying for the whole cut.
  const range = frameRange(tl, { scenes: args.scenes, from: args.from, to: args.to, frames: args.frames });
  const part = Boolean(range) && !(range[0] === 0 && range[1] >= Math.round(tl.duration * tl.fps) - 1);
  // The full cut renders only what the user has seen and signed off as stills; drafts, parts and
  // other frame sizes are how the preview gets there, so they are not held back.
  if (!draft && !part && !project.aspect && !args.out) {
    const gate = previewGate(project);
    if (gate) throw new UserError(gate);
  }
  const variant = project.aspect && !args.out ? join(project.paths.out, `${project.config.name}.${aspectTag(project.aspect)}${draft ? ".draft" : ""}${part ? ".part" : ""}.mp4`) : null;
  const alias = args.out || variant ? null : part ? join(project.paths.out, `${project.config.name}.part.mp4`) : draft ? join(project.paths.out, `${project.config.name}.draft.mp4`) : videoPath(project);
  if (alias) {
    const old = adoptLegacy(project, alias, { draft, part });
    if (old) log(`kept the unversioned ${relative(project.root, alias)} as v${old.v} (${old.file})`);
  }
  const { v, file } = args.out || variant ? { v: null, file: args.out ?? variant } : versionFile(project, { draft, part });
  const flags = [
    "render", ENTRY, COMPOSITION, file, ...commonFlags(project),
    "--codec=h264", "--audio-codec=aac", "--audio-bitrate=192k",
    `--concurrency=${args.concurrency ?? project.config.render?.concurrency ?? autoConcurrency()}`,
    `--crf=${draft ? 30 : project.config.render?.crf ?? 18}`,
    "--image-format=jpeg", `--jpeg-quality=${draft ? 70 : 90}`,
  ];
  if (draft) flags.push("--scale=0.5");
  // OffthreadVideo's frame cache defaults to a share of free memory; on a small render node it
  // evicts frames as soon as they are extracted ("No frame found at position"). Pin it when the
  // timeline plays video (render.videoCacheMB, default 512).
  if (Object.values(tl.assets ?? {}).some((a) => a.kind === "video")) {
    flags.push(`--offthreadvideo-cache-size-in-bytes=${Math.round((project.config.render?.videoCacheMB ?? 512) * 1024 * 1024)}`);
  }
  if (range) flags.push(`--frames=${range[0]}-${range[1]}`);
  const span = range ? `${(range[0] / tl.fps).toFixed(1)}–${((range[1] + 1) / tl.fps).toFixed(1)}s of ` : "";
  log(`rendering ${span}${tl.duration.toFixed(1)}s ${tl.width}x${tl.height}${draft ? " (draft, half scale)" : ""}${v ? ` as v${v}` : ""} → ${file}`);
  const t0 = Date.now();
  await run(REMOTION_BIN, flags, { cwd: TEMPLATE_DIR, stdio: "inherit" });
  const secs = Math.round((Date.now() - t0) / 1000);
  if (!v) { log(`rendered in ${secs}s → ${file}`); return file; }
  const prev = readRenders(project).at(-1);
  const hash = timelineHash(tl);
  const rec = recordRender(project, {
    v, file, at: new Date().toISOString(), draft, part, offset: range ? +(range[0] / tl.fps).toFixed(3) : 0,
    frames: range ?? [0, Math.round(tl.duration * tl.fps) - 1], ...(args.scenes ? { scenes: String(args.scenes).split(",") } : {}),
    timeline: hash, seconds: secs, ...(typeof args.note === "string" ? { note: args.note } : {}),
  }, { alias });
  log(`rendered v${v} in ${secs}s → ${rec.file} (${rec.alias})${prev && prev.timeline === hash ? `; timeline unchanged since v${prev.v}` : ""}`);
  if (prev) log(`compare: onevideo sheet --vs v${prev.v}`);
  return alias;
}

export async function versions(args) {
  const project = loadProject();
  const renders = readRenders(project);
  if (args.json) return console.log(JSON.stringify(renders, null, 2));
  if (!renders.length) return log("no renders yet; run: onevideo render [--draft] [--scenes a,b]");
  for (const r of renders) {
    const kind = [r.draft ? "draft" : "full", r.part ? "part" : null].filter(Boolean).join("+");
    const span = r.part ? `from ${r.offset}s, ${r.frames[1] - r.frames[0] + 1}f${r.scenes ? ` ${r.scenes.join(",")}` : ""}` : "whole";
    log(`  ${`v${r.v}`.padEnd(5)} ${localStamp(r.at)}  ${kind.padEnd(10)} ${span.padEnd(20)} tl ${r.timeline ?? "—".padEnd(12)}  ${r.pruned ? "(pruned) " : ""}${r.note ?? ""}`);
  }
  log(`compare two: onevideo sheet --video v${renders.at(-1).v} --vs v${renders.at(-2)?.v ?? renders.at(-1).v}`);
}

// One JPEG per scene and fraction of it (--at 0.7 or a list 0.3,0.6,0.9; a list adds the fraction to the name).
async function renderStills(project, tl, { dir, only = null, ats = [0.7] }) {
  if (ats.some((a) => !Number.isFinite(a) || a < 0 || a > 1)) throw new UserError(`--at takes fractions 0–1, got "${ats.join(",")}"`);
  mkdirSync(dir, { recursive: true });
  const shots = [];
  for (const [i, s] of tl.scenes.entries()) {
    if (only && !only.includes(s.id)) continue;
    for (const at of ats) {
      const frame = s.from + Math.min(s.durationInFrames - 1, Math.floor(s.durationInFrames * at));
      const file = join(dir, `${String(i + 1).padStart(2, "0")}-${s.id}${ats.length > 1 ? `@${at}` : ""}.jpg`);
      await run(REMOTION_BIN, ["still", ENTRY, COMPOSITION, file, ...commonFlags(project), `--frame=${frame}`, "--image-format=jpeg", "--scale=0.5"], { cwd: TEMPLATE_DIR });
      log(`✓ ${file}`);
      shots.push({ scene: s.id, at, t: +(frame / tl.fps).toFixed(2), file });
    }
  }
  return shots;
}

export async function stills(args) {
  requireRemotion();
  const project = withAspect(loadProject(), args.aspect);
  await ensureClipFrames(project);
  await ensureMusicBeats(project);
  await ensureAspectTimings(project);
  const tl = freshTimeline(project, { force: Boolean(args.force) });
  const dir = join(project.paths.out, "stills", ...(project.aspect ? [aspectTag(project.aspect)] : []));
  await renderStills(project, tl, { dir, only: typeof args.scene === "string" ? args.scene.split(",") : null, ats: args.at !== undefined ? String(args.at).split(",").map(Number) : [0.7] });
}

// The pre-render review: every scene as the render will show it (early and late in the scene, so
// overlays that come in on a cue are caught), tiled into out/qc/preview-NN.jpg. The user approves
// this (onevideo approve preview) before the full render; it goes stale when the timeline changes.
export const PREVIEW_AT = [0.3, 0.8];
export async function preview(args) {
  requireRemotion();
  const project = loadProject();
  await ensureClipFrames(project);
  await ensureMusicBeats(project);
  const tl = freshTimeline(project, { force: Boolean(args.force) });
  const dir = join(project.paths.out, "preview");
  rmSync(dir, { recursive: true, force: true });
  const ats = args.at !== undefined ? String(args.at).split(",").map(Number) : PREVIEW_AT;
  const shots = await renderStills(project, tl, { dir, ats });
  const sheets = await writeImageSheets(shots, join(project.paths.out, "qc"), { prefix: "preview", cols: ats.length * 2 });
  const { issues } = checkProject(project, { needTimings: true });
  const layout = issues.filter((i) => i.gate === "layout" || i.gate === "rhythm").map((i) => `${i.level}: ${i.msg}`);
  writeJson(project.p("plan", "preview.json"), {
    timeline: productsHash(project.root, ["plan/timeline.json"]),
    at: new Date().toISOString(),
    sheets: sheets.map((s) => relative(project.root, s.file)),
    scenes: tl.scenes.map((s) => ({ id: s.id, type: s.type, start: s.start, stills: shots.filter((x) => x.scene === s.id).map((x) => relative(project.root, x.file)) })),
    layout,
  });
  for (const s of sheets) log(`✓ ${relative(project.root, s.file)}  ${s.cols}×${s.rows}, ${ats.length} cell(s) per scene, in scene order`);
  log(`next: show the preview sheet(s) to the user; once they sign off: onevideo approve preview, then onevideo render`);
}

export async function studio(args) {
  requireRemotion();
  const project = loadProject();
  await ensureClipFrames(project);
  await ensureMusicBeats(project);
  freshTimeline(project, { force: true });
  await run(REMOTION_BIN, ["studio", ENTRY, ...commonFlags(project), ...(args.port ? [`--port=${args.port}`] : [])], { cwd: TEMPLATE_DIR, stdio: "inherit" });
}

export async function qc(args) {
  const project = loadProject();
  const main = videoPath(project);
  const { file: video, offset, entry } = args.video ? resolveVideo(project, args.video) : { file: main, offset: 0, entry: null };
  if (!existsSync(video)) throw new UserError(`no video at ${video}; run: onevideo render`);
  const tl = readJson(project.paths.timeline);
  // Only the main cut's report is the review stage's product (and records which render it was);
  // another version's report goes beside its own frames, so it can never be approved for publishing.
  const isMain = video === main || sameFile(video, main);
  const subject = isMain ? reviewSubject(project) : null;
  const outDir = isMain ? join(project.paths.out, "qc") : join(project.paths.out, "qc", entry ? `v${entry.v}` : basename(video, ".mp4"));
  const span = entry?.part && entry.frames ? (entry.frames[1] - entry.frames[0] + 1) / tl.fps : undefined;
  const review = await runQc({ video, timeline: tl, outDir, thresholds: project.config.qc, offset, span });
  const reportPath = isMain ? project.paths.review : join(outDir, "review.json");
  writeJson(reportPath, isMain ? { ...review, subject } : review);
  const icon = { pass: "✓", warn: "⚠", fail: "✗" };
  for (const c of review.checks) log(`${icon[c.status]} ${c.id.padEnd(22)} ${c.detail}`);
  const framesRel = relative(project.root, join(outDir, "frames"));
  log(`verdict: ${review.verdict.toUpperCase()} · ${review.frames.length} review frames in ${framesRel}/ → ${relative(project.root, reportPath)}`);
  if (isMain) log(`next: look at every frame in ${framesRel}/ before approving review`);
  else log(`not the main cut (${relative(project.root, main)}): this report is for comparison and does not count as the review`);
  if (review.verdict === "fail") process.exitCode = 1;
  return review;
}

// Publishing needs the human review sign-off on the current QC report (onevideo approve review).
export async function publish(args = {}) {
  const project = loadProject();
  const tl = readJson(project.paths.timeline);
  const script = readJson(project.paths.script);
  const research = existsSync(project.paths.research) ? readJson(project.paths.research) : null;
  const review = existsSync(project.paths.review) ? readJson(project.paths.review) : null;
  if (!review) throw new UserError("no QC review yet; run: onevideo qc");
  if (review.verdict === "fail") throw new UserError("QC verdict is FAIL; fix and re-render before publishing");
  const reviewStage = stageStatus(project, pipelineDef(project.config.pipeline)).find((s) => s.id === "review");
  if (reviewStage && reviewStage.status !== "approved") {
    const why = reviewStage.reason ? ` (${reviewStage.reason})` : "";
    if (!args.force) throw new UserError(`review stage is ${reviewStage.status}${why}; look at out/qc/frames/, then: onevideo approve review (or publish --force)`);
    warn(`publishing without review approval (review stage is ${reviewStage.status}${why})`);
  }
  const kit = buildPublishKit({ timeline: tl, research, config: project.config, script });
  const dir = join(project.paths.out, "publish");
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(kit.files)) writeFileSync(join(dir, name), content);
  kit.publish.formats = await publishFormats(project, dir, args.formats);
  writeJson(project.paths.publish, kit.publish);
  for (const w of kit.publish.warnings) warn(w);
  log(`publish kit → ${dir} (${Object.keys(kit.files).join(", ")})`);
  if (args.stems) await stems({ _: [] });
  // The published cut and everything behind it go to the archive when one is configured.
  if (driveConfig() && !args.noArchive) {
    try { await archiveProject(project, { log, warn }); }
    catch (e) { warn(`archive: ${e.message}; run onevideo archive again`); }
  }
}

// Other sizes of the same cut for other platforms (9:16 for short-video apps, 1:1 / 4:5 for feeds).
// --formats renders the ones missing or older than the timeline; any variant already rendered
// (out/<name>.<w>x<h>.mp4) goes into the kit with captions wrapped for its own frame.
async function publishFormats(project, dir, spec) {
  const main = project.config.aspect ?? "16:9";
  const asked = spec && spec !== true ? String(spec).split(",").map((s) => s.trim()).filter(Boolean) : [];
  for (const a of asked) if (!DIMENSIONS[a]) throw new UserError(`--formats "${a}": one of ${Object.keys(DIMENSIONS).join(", ")}`);
  const out = [];
  for (const aspect of Object.keys(DIMENSIONS).filter((a) => a !== main)) {
    const tag = aspectTag(aspect), file = join(project.paths.out, `${project.config.name}.${tag}.mp4`);
    const stale = !existsSync(file) || statSync(file).mtimeMs < statSync(project.paths.timeline).mtimeMs;
    if (asked.includes(aspect) && stale) await render({ _: [], aspect });
    else if (!existsSync(file)) continue;
    else if (stale) warn(`${relative(project.root, file)} is older than the timeline; publish --formats ${aspect} renders it again`);
    const tl = readJson(withAspect(project, aspect).paths.timeline);
    writeFileSync(join(dir, `captions.${tag}.srt`), toSrt(tl.captions.items));
    writeFileSync(join(dir, `captions.${tag}.vtt`), toVtt(tl.captions.items));
    out.push({ aspect, file: relative(project.root, file), width: tl.width, height: tl.height, captions: `captions.${tag}.srt` });
    log(`${aspect} → ${relative(project.root, file)} (captions.${tag}.srt)`);
  }
  return out;
}

// Voice, music and sound effects as separate WAVs at the mix's own levels (ducking included),
// so the cut can be remixed or re-voiced elsewhere; summed they give the published mix.
export async function stems(args = {}) {
  requireRemotion();
  const project = loadProject();
  if (!existsSync(project.paths.timeline)) throw new UserError("no timeline yet; run: onevideo timeline");
  const tl = readJson(project.paths.timeline);
  const groups = stemGroups(tl).filter((g) => !args.only || String(args.only).split(",").includes(g));
  if (!groups.length) throw new UserError("the timeline plays no sound to split");
  const dir = join(project.paths.out, "publish", "stems");
  mkdirSync(dir, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "ov-stem-"));
  try {
    for (const g of groups) {
      const props = join(tmp, `${g}.json`), file = join(dir, `${g}.wav`);
      writeJson(props, { ...tl, stem: g });
      await run(REMOTION_BIN, ["render", ENTRY, COMPOSITION, file, `--props=${props}`, `--public-dir=${project.p("public")}`, "--codec=wav", "--log=error"], { cwd: TEMPLATE_DIR });
      log(`✓ ${relative(project.root, file)}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  log(`stems → ${relative(project.root, dir)}/ (${groups.join(", ")}; together they are the published mix)`);
}

// Missing licensed files are fetched, clips get their frame sequences, and depth / luma maps are
// made when the depth tools exist: subject-aware dives, word dodging and scrims all read them.
async function prepareMedia(project) {
  if (!existsSync(project.paths.assets)) return;
  const items = readJson(project.paths.assets).items ?? [];
  if (items.some((a) => !assetFileExists(project.p("public"), a))) await media.assets({ _: ["fetch"] });
  await ensureClipFrames(project);
  const { missing } = media.depthTools();
  if (missing) warn(`depth skipped: ${missing}; text dodging, scrims and subject dives fall back to defaults`);
  else await media.depth({ _: [] });
}

// Full non-creative pass: voice → music → timeline → render → qc. Publishing waits for the
// human review sign-off, so build stops at the QC report.
// Why the full render must wait for the preview, or null when it is approved for this timeline.
export function previewGate(project) {
  const row = stageStatus(project, pipelineDef(project.config.pipeline)).find((s) => s.id === "preview");
  if (!row || row.status === "approved") return null;
  if (row.status === "pending") return "no preview yet: run onevideo preview, show out/qc/preview-*.jpg to the user, then onevideo approve preview (or render --draft / --scenes to iterate)";
  if (row.status === "stale") return `the preview is stale (${row.reason ?? "it changed after approval"}); run onevideo preview again and get it approved`;
  return "the preview is waiting for the user: show out/qc/preview-*.jpg, then onevideo approve preview";
}

export async function build(args) {
  await media.tts({ _: [], force: args.forceTts });
  await media.music({ _: [] });
  await prepareMedia(loadProject());
  await media.timeline({ _: [] });
  // Without an approved preview, build stops at it: the full render waits for the user's sign-off.
  if (!args.draft && previewGate(loadProject())) {
    await preview({ _: [] });
    return;
  }
  await render({ _: [], draft: args.draft, concurrency: args.concurrency });
  if (args.draft) return;
  const review = await qc({ _: [] });
  if (review.verdict !== "fail") log("next: review out/qc/frames/, then: onevideo approve review && onevideo publish");
}

export async function doctor() {
  const checks = [];
  const add = (ok, name, detail) => checks.push([ok, name, detail]);
  const major = Number(process.versions.node.split(".")[0]);
  add(major >= 20, "node", `v${process.versions.node} (need ≥ 20)`);
  try { execFileSync("curl", ["--version"], { stdio: "pipe" }); add(true, "curl", "available"); } catch { add(false, "curl", "not found (needed for API calls)"); }
  add(existsSync(REMOTION_BIN), "remotion", existsSync(REMOTION_BIN) ? TEMPLATE_DIR : `run: npm ci --prefix ${TEMPLATE_DIR}`);
  if (existsSync(REMOTION_BIN)) {
    try { await ffmpeg(["-version"]); add(true, "ffmpeg", "bundled with Remotion"); } catch (e) { add(false, "ffmpeg", e.message.split("\n")[0]); }
  }
  let cfg = {};
  try { cfg = loadProject().config; add(true, "project", cfg.name); } catch { add(true, "project", "not inside a project (ok)"); }
  const t = ttsConfig(cfg);
  const key = resolveApiKey(t.keyEnv, t.baseUrl);
  add(Boolean(key), "tts key", key ? `found via ${key.source}` : trustedKeyHost(t.baseUrl) ? `missing: set ${t.keyEnv}` : `missing: ${new URL(t.baseUrl).host} needs its own keyEnv variable`);
  add(true, "pexels", process.env.PEXELS_API_KEY ? "PEXELS_API_KEY set" : "optional; unset (NASA/Wikimedia/Openverse still work)");
  add(existsSync(join(ONEVIDEO_ROOT, "template", "src", "index.ts")), "template", join(ONEVIDEO_ROOT, "template"));
  // Generation and review share the relay key; listing the model order is enough here (no calls).
  const genKey = (c) => resolveApiKey(c.keyEnv, c.baseUrl);
  const img = { ...IMAGE_DEFAULTS, ...cfg.image }, vid = { ...VIDEO_DEFAULTS, ...cfg.video }, llm = llmConfig(cfg);
  const models = (c) => [].concat(c.model ?? c.models).join(" → ");
  add(true, "generate", `optional; image ${models(img)}${genKey(img) ? "" : " (no key)"} · video ${models(vid)}${genKey(vid) ? "" : " (no key)"}`);
  add(true, "look", `optional; ${models(llm)}${genKey(llm) ? "" : " (no key)"}`);
  const depth = media.depthTools();
  add(true, "depth", depth.missing ? `optional; ${depth.missing}` : `${depth.py} + ${depth.model}`);
  const workers = workerHosts();
  add(true, "workers", workers.length ? `${workers.join(", ")} (render/build/depth/stills/publish --formats run there; --local to stay)` : "optional; unset (heavy commands run here; ONEVIDEO_WORKERS=host,…)");
  for (const [ok, name, detail] of checks) log(`${ok ? "✓" : "✗"} ${name.padEnd(9)} ${detail}`);
  if (checks.some(([ok]) => !ok)) process.exitCode = 1;
}
