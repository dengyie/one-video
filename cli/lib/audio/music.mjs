import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { download } from "../core/http.mjs";
import { UserError, log, readJson } from "../core/project.mjs";
import { beatsFile, ensureBeats, everyFourth, gridBeats } from "./beats.mjs";
import { writeMusic, MUSIC_PRESETS } from "./synth.mjs";
import { STORY_BPM, storyArc, writeStory } from "./story.mjs";

const DEFAULT_MUSIC_SRC = "music/bgm.wav";

async function prepareProvided(project, { force }) {
  const { music } = project.config;
  const file = join(project.p("public"), music.file);
  if (!existsSync(file) || force) {
    if (!music.url) throw new UserError(`music.file public/${music.file} is missing; put the track there or set music.url`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, await download(music.url));
    log(`music: downloaded ${music.url} → public/${music.file}`);
  }
  if (force) rmSync(beatsFile(file), { force: true });
  const b = await ensureBeats(project.root, { src: music.file });
  log(`using provided music file ${music.file}${music.credit ? ` (${music.credit})` : ""}${b ? `, ~${b.bpm} BPM, ${b.beats.length} beats` : ""}`);
}

function prepareProcedural(project, args, pre) {
  const { config, paths } = project;
  const preset = args.preset ?? config.music?.preset ?? "ambient";
  if (!MUSIC_PRESETS[preset] && preset !== "story") throw new UserError(`unknown preset "${preset}" (${[...Object.keys(MUSIC_PRESETS), "story"].join(", ")})`);
  const duration = args.duration ? Number(args.duration) : pre.timeline ? pre.timeline.duration + 2 : null;
  if (!duration) throw new UserError("need timings to size the music; run: onevideo tts (or pass --duration <sec>)");
  mkdirSync(paths.musicDir, { recursive: true });
  const bgm = join(paths.musicDir, "bgm.wav");
  if (preset === "story") {
    // Scored to this cut: sections start on the scenes whose script beat opens them.
    const beatOf = new Map((pre.plan.script?.scenes ?? []).map((s) => [s.id, s.beat]));
    const scenes = (pre.timeline?.scenes ?? []).map((s) => ({ id: s.id, start: s.start, beat: beatOf.get(s.id) }));
    let sections;
    try { sections = storyArc(scenes, duration, config.music?.arc); } catch (e) { throw new UserError(e.message); }
    writeStory(bgm, duration, { seed: config.music?.seed ?? 7, sections });
    const grid = gridBeats(STORY_BPM, duration);
    const cut = Object.fromEntries(scenes.map((s) => [s.id, s.start]));
    writeFileSync(beatsFile(bgm), JSON.stringify({ bpm: STORY_BPM, beats: grid, downbeats: everyFourth(grid), source: "synth:story", scored: true, sections, cut }));
    log(`music: story, ${duration.toFixed(1)}s — ${sections.map((s) => `${s.mood} ${s.start.toFixed(1)}s`).join(" → ")} → public/music/bgm.wav`);
    return;
  }
  writeMusic(bgm, duration, { preset, seed: config.music?.seed ?? 7 });
  // The synth knows its own tempo: the beat grid is exact, no detection needed.
  const grid = gridBeats(MUSIC_PRESETS[preset].bpm, duration);
  writeFileSync(beatsFile(bgm), JSON.stringify({ bpm: MUSIC_PRESETS[preset].bpm, beats: grid, downbeats: everyFourth(grid), source: `synth:${preset}` }));
  log(`music: ${preset}, ${duration.toFixed(1)}s → public/music/bgm.wav`);
}

const MUSIC_PROVIDERS = {
  provided: { prepare: prepareProvided, src: (config) => config.file, credit: (config) => config.credit ?? null },
  procedural: { prepare: prepareProcedural, src: (config) => config?.file ?? DEFAULT_MUSIC_SRC, credit: () => "OneVideo 程序化合成" },
};

const musicProvider = (config) => MUSIC_PROVIDERS[config?.file ? "provided" : "procedural"];
const sourcePath = (config) => musicProvider(config).src(config);

export async function prepareMusic(project, args, pre) {
  const config = project.config.music;
  if (config?.enabled === false) return log("music disabled in onevideo.json");
  return musicProvider(config).prepare(project, args, pre);
}

export function ensureMusicBeats(root, config) {
  if (config?.enabled === false) return;
  return ensureBeats(root, { src: sourcePath(config) });
}

export function loadMusicGrid(root, config) {
  const file = root ? beatsFile(join(root, "public", sourcePath(config))) : null;
  return config?.enabled !== false && file && existsSync(file) ? readJson(file) : {};
}

export function compileMusic(config, { root, offset, grid, scenes, warnings }) {
  const musicSrc = sourcePath(config);
  const music = config?.enabled === false ? null : root && existsSync(join(root, "public", musicSrc))
    ? { src: musicSrc, offset, volume: config?.volume ?? 0.22, duckTo: config?.duckTo ?? 0.07, fade: 1.2, credit: musicProvider(config).credit(config) }
    : null;
  if (config?.enabled !== false && !music) warnings.push(`no background music (public/${musicSrc})${config?.file ? "" : "; run: onevideo music"}`);
  // The story score turns where its scenes started when it was written; a re-timed cut drifts off it.
  if (music && grid.scored && grid.cut) {
    const moved = scenes.filter((s) => grid.cut[s.id] !== undefined && Math.abs(grid.cut[s.id] - s.start) > 0.75).map((s) => s.id);
    const changed = scenes.length !== Object.keys(grid.cut).length || scenes.some((s) => grid.cut[s.id] === undefined);
    if (moved.length || changed) warnings.push(`music was scored for an earlier cut (${moved.length ? `scenes ${moved.join(", ")} moved` : "scenes changed"}); run: onevideo music`);
  }
  if (config?.file && !config?.credit) warnings.push("music.file has no music.credit; add the track title/author/license for the publish credits");
  return music;
}
