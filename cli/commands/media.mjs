// tts / music / timeline / assets / decide
import { appendFileSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { download } from "../lib/core/http.mjs";
import { UserError, loadProject, readJson, writeJson, log, warn, ONEVIDEO_ROOT } from "../lib/core/project.mjs";
import { runTts, ttsConfig } from "../lib/voice/tts.mjs";
import { sceneLines } from "../lib/captions/index.mjs";
import { writeMusic, synthSfx, SFX, MUSIC_PRESETS } from "../lib/audio/synth.mjs";
import { writeWav } from "../lib/audio/wav.mjs";
import { checkProject, printIssues } from "../lib/review/check.mjs";
import { search, fetchAsset, scoreCandidate, assetFileExists, depthPath, depthStep, lumaPath, framesDir, countFrames } from "../lib/assets/index.mjs";
import { run } from "../lib/core/ffmpeg.mjs";
import { AUTO_TRANSITION_SFX, DIMENSIONS, MOTION_SFX, overlaySound, sfxFile, sfxVariants } from "../lib/timeline/index.mjs";
import { categories, entryPath, loadCatalog, resolveSfx } from "../lib/library/catalog.mjs";
import { spokenLength } from "../lib/core/text.mjs";
import { beatsFile, ensureBeats, everyFourth, gridBeats } from "../lib/audio/beats.mjs";
import { captureUi, parseRects } from "../lib/vision/capture.mjs";
import { findScreen, frameRgb } from "../lib/vision/screen.mjs";

const list = (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

export async function tts(args) {
  const project = loadProject();
  const script = readJson(project.paths.script);
  if (args.sample) {
    // Synthesize only the first scene (first line in line unit) so voice and pacing can be approved before the batch.
    const first = script.scenes.find((s) => sceneLines(s, project.config).length);
    if (!first) throw new UserError("script has no narration");
    const sample = ttsConfig(project.config).unit === "line" ? { id: "_sample", lines: [sceneLines(first, project.config)[0]] } : { ...first, id: "_sample" };
    const res = await runTts(project, { ...script, scenes: [sample] }, { force: Boolean(args.force) });
    const s = res.scenes._sample;
    const text = s.lines.map((l) => l.text).join(" / ");
    const rate = s.lines.reduce((n, l) => n + spokenLength(l.text), 0) / Math.max(0.1, s.lines.reduce((n, l) => n + l.end - l.start, 0));
    log(`sample: public/${s.file} (${s.duration.toFixed(2)}s, ${rate.toFixed(1)} syllables/s) — "${text}"`);
    log(`voice ${ttsConfig(project.config).voice}; listen, then run: onevideo tts`);
    return;
  }
  const res = await runTts(project, script, { force: Boolean(args.force), only: list(args.only), dry: Boolean(args.dry) });
  if (!res) return;
  writeJson(project.paths.timings, res);
  const n = Object.values(res.scenes).reduce((k, s) => k + s.lines.length, 0);
  log(`timings: ${Object.keys(res.scenes).length} scenes, ${n} lines, narration ${res.totalNarration.toFixed(1)}s → plan/timings.json`);
}

const SYNTH_NEAREST = [[/whoosh|swish|whip|page/, "whoosh"], [/impact|boom|rocket|glitch|error/, "impact"], [/riser|swell/, "riser"], [/pop|click|shutter|marker|cash/, "pop"], [/ding|sting|success|crowd/, "chime"], [/tick|type|keyboard/, "tick"]];

export async function music(args) {
  const project = loadProject();
  const { config, paths } = project;
  const pre = checkProject(project);
  const sfxNames = new Set(list(args.sfx));
  const tr = config.sfx?.transition;
  const trNames = tr === "auto" ? Object.values(AUTO_TRANSITION_SFX) : typeof tr === "string" ? [tr] : Object.values(tr ?? {});
  for (const name of trNames) if (name) sfxNames.add(name);
  for (const sb of pre.plan.storyboard?.scenes ?? []) {
    for (const fx of sb.sfx ?? []) sfxNames.add(fx.sound);
    for (const t of [sb.enter, sb.exit]) if (t?.sfx) sfxNames.add(t.sfx);
    for (const ov of sb.overlays ?? []) { const s = overlaySound(ov, config.sfx); if (s?.sound) sfxNames.add(s.sound); }
  }
  // Library entries first (recorded, normalized), then procedural sounds; synth:<name> forces procedural.
  const catalog = loadCatalog();
  // Motion sounds rotate through every variant of their categories (see timeline motionCues).
  if (config.sfx?.motion === "auto") for (const cat of new Set(Object.values(MOTION_SFX))) for (const id of sfxVariants(cat, catalog)) sfxNames.add(id);
  const used = [];
  for (const name of sfxNames) {
    const file = join(project.p("public"), sfxFile(name));
    const synthName = name.startsWith("synth:") ? name.slice(6) : null;
    const lib = synthName ? null : resolveSfx(name, catalog);
    if (lib) {
      if (lib.fallback) warn(`sfx "${name}": default ${catalog.defaults[name]} is not on this host; using ${lib.entry.id} (renders elsewhere may differ)`);
      if (!existsSync(file) || args.force) { mkdirSync(dirname(file), { recursive: true }); copyFileSync(entryPath(lib.entry), file); }
      used.push(`${name}→${lib.entry.id}`);
      continue;
    }
    // A library category whose files all live on another host falls back to the nearest synth.
    const near = !synthName && !SFX[name] && categories(catalog).includes(name) ? SYNTH_NEAREST.find(([re]) => re.test(name))?.[1] : null;
    if (near) warn(`sfx "${name}": no library file on this host; using procedural ${near} (render on the VM for the recorded sound)`);
    const proc = synthName ?? near ?? name;
    if (!SFX[proc]) throw new UserError(`unknown sfx "${name}": not in the library (${categories(catalog).join(", ") || "empty; run: onevideo lib import"}) nor procedural (${Object.keys(SFX).join(", ")})`);
    if (!existsSync(file) || args.force) writeWav(file, synthSfx(proc));
    used.push(`${name}→synth`);
  }
  if (used.length) log(`sfx: ${used.join(", ")} → public/sfx/`);

  if (config.music?.enabled === false) return log("music disabled in onevideo.json");
  if (config.music?.file) {
    const file = join(project.p("public"), config.music.file);
    if (!existsSync(file) || args.force) {
      if (!config.music.url) throw new UserError(`music.file public/${config.music.file} is missing; put the track there or set music.url`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, await download(config.music.url));
      log(`music: downloaded ${config.music.url} → public/${config.music.file}`);
    }
    if (args.force) rmSync(beatsFile(file), { force: true });
    const b = await ensureBeats(project.root, { src: config.music.file });
    log(`using provided music file ${config.music.file}${config.music.credit ? ` (${config.music.credit})` : ""}${b ? `, ~${b.bpm} BPM, ${b.beats.length} beats` : ""}`);
    return;
  }
  const preset = args.preset ?? config.music?.preset ?? "ambient";
  if (!MUSIC_PRESETS[preset]) throw new UserError(`unknown preset "${preset}" (${Object.keys(MUSIC_PRESETS).join(", ")})`);
  const duration = args.duration ? Number(args.duration) : pre.timeline ? pre.timeline.duration + 2 : null;
  if (!duration) throw new UserError("need timings to size the music; run: onevideo tts (or pass --duration <sec>)");
  mkdirSync(paths.musicDir, { recursive: true });
  const bgm = join(paths.musicDir, "bgm.wav");
  writeMusic(bgm, duration, { preset, seed: config.music?.seed ?? 7 });
  // The synth knows its own tempo: the beat grid is exact, no detection needed.
  const grid = gridBeats(MUSIC_PRESETS[preset].bpm, duration);
  writeFileSync(beatsFile(bgm), JSON.stringify({ bpm: MUSIC_PRESETS[preset].bpm, beats: grid, downbeats: everyFourth(grid), source: `synth:${preset}` }));
  log(`music: ${preset}, ${duration.toFixed(1)}s → public/music/bgm.wav`);
}

export async function timeline(args) {
  const project = loadProject();
  const res = checkProject(project, { needTimings: true });
  printIssues(res.issues);
  if (res.errors.length && !args.force) throw new UserError(`${res.errors.length} error(s); fix them (or --force to write anyway)`);
  writeJson(project.paths.timeline, res.timeline);
  const t = res.timeline;
  log(`timeline: ${t.scenes.length} scenes, ${t.duration.toFixed(1)}s (${t.totalFrames} frames @ ${t.fps}fps) → plan/timeline.json`);
}

export async function assets(args) {
  const sub = args._[0];
  const project = loadProject();
  const { paths, config } = project;
  const [w, h] = DIMENSIONS[config.aspect ?? "16:9"];
  if (sub === "search") {
    const query = args._.slice(1).join(" ");
    if (!query) throw new UserError("usage: onevideo assets search <query> [--provider nasa,wikimedia,openverse,pexels] [--kind image|video]");
    const { results, errors } = await search(query, { providers: args.provider ? list(args.provider) : undefined, kind: args.kind ?? "image", limit: Number(args.limit ?? 8) });
    for (const e of errors) warn(e);
    const ranked = results.sort((a, b) => scoreCandidate(a, w / h) - scoreCandidate(b, w / h));
    if (args.json) return log(JSON.stringify(ranked, null, 2));
    ranked.forEach((c, i) => log(`${String(i).padStart(2)} ${c.provider.padEnd(9)} ${(c.license ?? "").padEnd(14)} ${c.width ?? "?"}x${c.height ?? "?"}  ${(c.title ?? "").slice(0, 60)}\n     ${c.source}${c.author ? ` · ${c.author.slice(0, 40)}` : ""}`));
    return;
  }
  if (sub === "fetch") {
    const manifest = readJson(paths.assets, { items: [] });
    const only = list(args.only);
    let changed = 0, failed = 0;
    const gen = { aspect: config.aspect ?? "16:9", image: config.image, video: config.video, llm: config.llm, onWarn: warn, lookup: (id) => manifest.items.find((x) => x.id === id) };
    // Clips animated from a generated still come after the still.
    const order = manifest.items.map((_, i) => i).sort((a, b) => Boolean(manifest.items[a].generate?.from) - Boolean(manifest.items[b].generate?.from));
    for (const i of order) {
      const item = manifest.items[i];
      if (only.length && !only.includes(item.id)) continue;
      if (assetFileExists(project.p("public"), item) && !args.force && !item.fallback) continue;
      try {
        const updated = await fetchAsset(item, { publicDir: project.p("public"), aspect: w / h, gen });
        manifest.items[i] = updated;
        changed++;
        log(`✓ ${item.id}: ${updated.file} · ${updated.license}${updated.author ? ` · ${updated.author.slice(0, 40)}` : ""}`);
        writeJson(paths.assets, manifest);
      } catch (e) {
        failed++;
        warn(`${item.id}: ${e.message}`);
      }
    }
    log(`${changed} fetched, ${failed} failed`);
    if (failed) process.exitCode = 1;
    return;
  }
  throw new UserError("usage: onevideo assets <search|fetch> …");
}

// Real UI for a promo: open the page in our own headless Chrome at a device viewport, screenshot
// it into public/assets/<id>.png and record it (with the rects a device scene can tap or open by
// name) in plan/assets.json. The settings are kept, so assets fetch --force re-shoots it.
export async function capture(args) {
  const url = args._[0];
  if (!url || !args.id) throw new UserError("usage: onevideo capture <url> --id <asset-id> [--device phone|tablet|desktop] [--wait ms] [--click sel,…] [--rects name=sel,…] [--full] [--dark]");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(args.id)) throw new UserError(`--id "${args.id}": lowercase letters, digits, - and _`);
  const project = loadProject();
  const manifest = readJson(project.paths.assets, { items: [] });
  const prev = manifest.items.find((x) => x.id === args.id);
  const settings = { url, device: args.device ?? "phone", wait: Number(args.wait ?? 1500), click: list(args.click), selectors: parseRects(args.rects), full: Boolean(args.full), dark: Boolean(args.dark) };
  const item = await captureItem({ ...prev, id: args.id, capture: settings }, project.p("public"));
  manifest.items = prev ? manifest.items.map((x) => (x.id === args.id ? item : x)) : [...manifest.items, item];
  writeJson(project.paths.assets, manifest);
  log(`✓ ${item.id}: ${item.file} ${item.width}x${item.height} (${settings.device}${settings.full ? ", full page" : ""})`);
  for (const [k, r] of Object.entries(item.rects ?? {})) log(`  rect ${k}: [${r.join(", ")}]`);
}

export async function captureItem(item, publicDir) {
  const c = item.capture;
  const shot = await captureUi({ url: c.url, device: c.device, wait: c.wait, click: c.click ?? [], rects: c.selectors ?? {}, full: c.full, dark: c.dark });
  if (shot.missing.length) warn(`${item.id}: no element for rect(s) ${shot.missing.join(", ")}`);
  mkdirSync(join(publicDir, "assets"), { recursive: true });
  const file = `assets/${item.id}.png`;
  writeFileSync(join(publicDir, file), shot.png);
  const { generate: _g, query: _q, url: _u, ...rest } = item;
  return { ...rest, kind: "image", file, via: "capture", license: item.license ?? "own", title: item.title ?? c.url, source: c.url, width: shot.width, height: shot.height, capture: { ...c, viewport: shot.viewport }, rects: shot.rects, fetchedAt: new Date().toISOString() };
}

// The four corners of a dark screen in footage (an image, or a video at --at seconds), printed as
// the footage.props.screen snippet to paste into the storyboard.
export async function screen(args) {
  const id = args._[0];
  if (!id) throw new UserError("usage: onevideo screen <asset-id> [--at s] [--threshold 40]");
  const project = loadProject();
  const item = readJson(project.paths.assets, { items: [] }).items.find((x) => x.id === id);
  if (!item?.file) throw new UserError(`asset "${id}" is not fetched (onevideo assets fetch)`);
  const { rgb, w, h } = await frameRgb(join(project.p("public"), item.file), { t: Number(args.at ?? 0), width: 640 });
  const hit = findScreen(rgb, w, h, { threshold: Number(args.threshold ?? 40) });
  if (!hit) throw new UserError(`no dark screen found in "${id}" (try --threshold 60, or a frame where the screen is off: --at s)`);
  if (hit.border) warn("the darkest region touches the frame edge; check the corners on a still before using them");
  log(`screen: ${(hit.share * 100).toFixed(1)}% of the frame`);
  log(JSON.stringify({ screen: { asset: "<ui-asset-id>", corners: hit.corners, blend: "screen" } }));
}

// Append-only decision log: the latest entry per (category, subject) wins.
export async function decide(args) {
  const [category, subject] = args._;
  if (!category || !subject || !args.selected) throw new UserError('usage: onevideo decide <category> <subject> --selected X [--options a,b] [--reason "…"]');
  const project = loadProject();
  const entry = { at: new Date().toISOString(), category, subject, selected: args.selected, options: list(args.options), reason: args.reason ?? "" };
  appendFileSync(project.p("plan", "decisions.jsonl"), JSON.stringify(entry) + "\n");
  log(`decision recorded: ${category}/${subject} = ${args.selected}`);
}

// Depth maps for parallax and text-behind-subject: Depth Anything V2 (ONNX, CPU) through the
// helper venv. Images → <file>.depth.png; videos → <file>.depth/NNNN.png every --step frames.
// Python + ONNX model behind `depth`; `missing` says what to set when either is absent.
export function depthTools() {
  const py = process.env.ONEVIDEO_PY ?? "/opt/onevideo-py/bin/python";
  const model = process.env.ONEVIDEO_DEPTH_MODEL ?? "/srv/onevideo/library/models/depth-anything-v2-small.onnx";
  const missing = !existsSync(py) ? `python not found at ${py} (set ONEVIDEO_PY; needs numpy, pillow, onnxruntime)`
    : !existsSync(model) ? `depth model not found at ${model} (set ONEVIDEO_DEPTH_MODEL)` : null;
  return { py, model, missing };
}

export async function depth(args) {
  const project = loadProject();
  const items = existsSync(project.paths.assets) ? readJson(project.paths.assets).items ?? [] : [];
  const ids = args._.length ? args._.flatMap((x) => String(x).split(",")) : null;
  const { py, model, missing } = depthTools();
  if (missing) throw new UserError(missing);
  const todo = items.filter((a) => a.file && (a.kind === "image" || a.kind === "video") && (!ids || ids.includes(a.id)));
  for (const id of ids ?? []) if (!items.some((a) => a.id === id)) throw new UserError(`unknown asset "${id}"`);
  if (!todo.length) return log("no image/video assets to process");
  const script = join(ONEVIDEO_ROOT, "cli", "py", "depth.py");
  const storyboard = existsSync(project.paths.storyboard) ? readJson(project.paths.storyboard) : null;
  for (const a of todo) {
    const out = project.p("public", depthPath(a));
    let src = project.p("public", a.file);
    const extra = [];
    if (a.kind === "video") {
      src = project.p("public", framesDir(a.file));
      if (!countFrames(src)) throw new UserError(`asset "${a.id}" has no frame sequence yet; run: onevideo stills (or render) once to extract it`);
      extra.push("--step", String(args.step ?? depthStep(storyboard, a.id)));
    }
    // The luma grid is cheap: made whenever it is missing, even when the depth map already exists.
    if (!existsSync(project.p("public", lumaPath(a))) || args.force) {
      await run(py, [join(ONEVIDEO_ROOT, "cli", "py", "luma.py"), src, project.p("public", lumaPath(a)), ...extra], { cwd: project.root });
      log(`✓ ${a.id}: public/${lumaPath(a)}`);
    }
    // A sparse clip map is redone once a title behind its subject needs it denser.
    const meta = join(out, "meta.json"), have = a.kind === "video" && existsSync(meta) ? readJson(meta).step : 0;
    if (existsSync(out) && !args.force && !(have > Number(extra[1]))) { log(`✓ ${a.id}: public/${depthPath(a)} (exists; --force to redo)`); continue; }
    log(`depth: ${a.id} → public/${depthPath(a)}`);
    const t0 = Date.now();
    await run(py, [script, model, src, out, ...extra], { cwd: project.root, stdio: "inherit" });
    log(`✓ ${a.id} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
