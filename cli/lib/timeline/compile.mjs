// Timeline compiler: script + storyboard + measured timings → plan/timeline.json.
// The Remotion template reads only this file, so every timing decision lives here. The passes it
// runs live next to it (cues, transitions, sfx, shots, props, anchors, credits); caption placement
// lives in ../captions.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { styleDef } from "../core/project.mjs";
import { collectIcons, resolveIcon } from "../library/icons.mjs";
import { resolveCountry } from "../library/geo.mjs";
import { entryPath, isMonoDark, loadCatalog, resolveEntry, tintLottie } from "../library/catalog.mjs";
import { parseWav } from "../audio/wav.mjs";
import { countFrames, depthPath, framesDir, lumaPath } from "../assets/media.mjs";
import { beatsFile } from "../audio/beats.mjs";
import { boxMean, depthAt, dodgeX, hexLuminance, lumaAt, scrimFor, subjectFocus, wordBox } from "../vision/subject.mjs";
import { placeCaptions } from "../captions/layout.mjs";
import { resolveAt } from "./cues.mjs";
import { CAMERA_DEFAULT, boundaryTransition, normTransition } from "./transitions.mjs";
import { MOTION_GAIN, MOTION_SFX, motionCues, overlaySound, sfxFile, sfxVariants, slamWord, transitionSfx } from "./sfx.mjs";
import { bestOffset, compileShots, hardCuts, rampShots } from "./shots.mjs";
import { anchorNames } from "./anchors.mjs";
import { resolveDeviceRects, resolvePropTimes, settled } from "./props.mjs";
import { collectAssetRefs, credit, libraryCredit, sourceList } from "./credits.mjs";
import { clampT, r3 } from "./util.mjs";

export const DIMENSIONS = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };
export const DEFAULT_HOLD = 0.5;
export const SILENT_SCENE_DEFAULT = 4;

const normCamera = (c) => (c == null ? null : typeof c === "string" ? { move: c } : c);

// Scene types that paint the whole frame themselves (no theme background shows through).
const OPAQUE_TYPES = new Set(["media", "focus", "split", "footage", "parallax", "match-cut"]);

const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

export function compileTimeline({ config, script, storyboard, timings, assets, research, root }) {
  const errors = [];
  const warnings = [];
  const fps = config.fps ?? 30;
  const [width, height] = config.width && config.height ? [config.width, config.height] : DIMENSIONS[config.aspect ?? "16:9"] ?? DIMENSIONS["16:9"];
  const theme = mergeTheme(styleDef(config.style ?? "midnight-data"), config.theme);
  const scriptById = new Map(script.scenes.map((s) => [s.id, s]));
  const assetById = new Map((assets?.items ?? []).map((a) => [a.id, a]));
  const usedAssets = {};
  const icons = {};
  const lottie = {};
  const libraryCredits = [];
  let catalog = null;
  const scenes = [];
  const captions = [];
  const narration = [];
  const sfx = [];
  const chapters = [];
  let frame = 0;

  const sfxCfg = { transition: null, volume: 0.5, ...(config.sfx ?? {}) };
  // Beat grid of the music, cached by `onevideo music` / render (see beats.mjs).
  const musicSrc = config.music?.file ?? "music/bgm.wav";
  const beatsAt = root ? beatsFile(join(root, "public", musicSrc)) : null;
  const grid = config.music?.enabled !== false && beatsAt && existsSync(beatsAt) ? JSON.parse(readFileSync(beatsAt, "utf8")) : {};
  // music.offset starts the track that many seconds in; "auto" picks the start that lands the
  // hard cuts on downbeats (a dry compile without snapping says where they fall).
  let offset = typeof config.music?.offset === "number" ? config.music.offset : 0;
  if (config.music?.offset === "auto" && grid.downbeats?.length) {
    const dry = compileTimeline({ config: { ...config, music: { ...config.music, offset: 0 }, beats: { ...config.beats, snap: false } }, script, storyboard, timings, assets, research, root });
    if (dry.timeline) offset = bestOffset(hardCuts(dry.timeline), grid.downbeats);
  }
  const shift = (list) => (list ?? []).map((b) => r3(b - offset)).filter((b) => b >= 0);
  const beats = shift(grid.beats);
  const downbeats = shift(grid.downbeats);
  const snap = config.beats?.snap !== false;
  let lastCanvas = null;

  for (const sb of storyboard.scenes) {
    const sc = scriptById.get(sb.id);
    if (!sc) { errors.push(`storyboard scene "${sb.id}" has no script entry`); continue; }
    const tm = timings?.scenes?.[sb.id];
    if (!tm && (sc.narration || sc.lines)) { errors.push(`scene "${sb.id}" has narration but no audio; run: onevideo tts`); continue; }
    const lines = tm?.lines ?? [];
    const speech = tm?.duration ?? 0;
    let duration = speech ? speech + (sb.hold ?? DEFAULT_HOLD) : sb.duration ?? SILENT_SCENE_DEFAULT;
    if (sb.duration && speech && sb.duration < speech) warnings.push(`scene "${sb.id}": duration ${sb.duration}s is shorter than its narration (${speech.toFixed(2)}s); using narration length`);
    if (sb.duration) duration = Math.max(duration, sb.duration);
    if (sb.minDuration) duration = Math.max(duration, sb.minDuration);
    const durationInFrames = Math.ceil(duration * fps);
    duration = durationInFrames / fps;
    const from = frame;
    const start = from / fps;

    const cues = {};
    for (const [name, at] of Object.entries(sb.cues ?? {})) {
      const res = resolveAt(at, lines, duration);
      if (res.error) { errors.push(`scene "${sb.id}" cue "${name}": ${res.error}`); continue; }
      cues[name] = r3(clampT(res.t, duration));
    }
    for (const fx of sb.sfx ?? []) {
      const res = resolveAt(fx.at ?? 0, lines, duration);
      if (res.error) { errors.push(`scene "${sb.id}" sfx "${fx.sound}": ${res.error}`); continue; }
      sfx.push({ sound: fx.sound, src: sfxFile(fx.sound), at: r3(start + clampT(res.t, duration)), volume: fx.volume ?? sfxCfg.volume });
    }

    const overlays = [];
    for (const [k, ov] of (sb.overlays ?? []).entries()) {
      const where = `scene "${sb.id}" overlay ${k} (${ov.type})`;
      const res = resolveAt(ov.at ?? 0, lines, duration);
      if (res.error) { errors.push(`${where}: ${res.error}`); continue; }
      if (ov.on !== undefined) {
        const names = anchorNames(sb.type, sb.props);
        if (!names) { errors.push(`${where}: on "${ov.on}": ${sb.type} scenes have no anchors (stat-cards, compare, share, bar-compare do)`); continue; }
        if (!names.includes(ov.on)) { errors.push(`${where}: on "${ov.on}" is not an element of this ${sb.type} scene (${names.join(", ")})`); continue; }
      }
      const t = clampT(res.t, duration);
      const { at, duration: d, sfx: _sfx, ...rest } = ov;
      const o = { ...structuredClone(rest), t: r3(t), end: r3(d ? Math.min(duration + 0.5, t + d) : duration + 0.5) };
      if (ov.type === "lottie") {
        const src = ov.src;
        if (!lottie[src]) {
          catalog ??= loadCatalog();
          const hit = typeof src === "string" ? resolveEntry(src, catalog, "lottie") : null;
          const file = hit ? entryPath(hit.entry) : root && typeof src === "string" && src.endsWith(".json") ? join(root, "public", src) : null;
          if (!file || !existsSync(file)) { errors.push(`${where}: unknown lottie "${src}" (library id/category, see onevideo lib list --kind lottie, or a .json under public/)`); continue; }
          lottie[src] = JSON.parse(readFileSync(file, "utf8"));
          const line = hit && libraryCredit(hit.entry);
          if (line && !libraryCredits.includes(line)) libraryCredits.push(line);
        }
        // Explicit tint, or black line icons tinted to the theme's text colour so they read on dark backgrounds.
        const tint = ov.tint ?? (isMonoDark(lottie[src]) ? theme.colors?.text : null);
        if (tint) {
          const key = `${src}#${tint}`;
          try { lottie[key] ??= tintLottie(lottie[src], tint); } catch (e) { errors.push(`${where}: ${e.message}`); continue; }
          o.src = key;
          delete o.tint;
        }
      }
      // With motion sounds on, a slammed word lands on an impact from the motion pass instead.
      const snd = sfxCfg.motion === "auto" && slamWord(ov) && ov.sfx === undefined ? null : overlaySound(ov, sfxCfg);
      if (snd?.sound) sfx.push({ sound: snd.sound, src: sfxFile(snd.sound), at: r3(start + t), volume: snd.volume ?? sfxCfg.volume });
      overlays.push(o);
    }

    const props = structuredClone(sb.props ?? {});
    const ctx = { cues, lines, duration, start, beats, downbeats, snap };
    // A canvas scene with `inherit` continues the previous canvas: same world, camera picks up
    // where it left off (cut into it for a seamless join).
    if (sb.type === "canvas" && props.inherit) {
      if (!lastCanvas) errors.push(`scene "${sb.id}": canvas inherit needs an earlier canvas scene`);
      else {
        const own = new Map((props.items ?? []).map((it) => [it.id, it]));
        props.items = [...lastCanvas.items.filter((it) => !own.has(it.id)).map(settled), ...(props.items ?? [])];
        const end = lastCanvas.path?.[lastCanvas.path.length - 1];
        if (end) props.path = [{ ...end, at: 0, cue: undefined, cut: true }, ...(props.path ?? [])];
      }
    }
    resolvePropTimes(sb.type, props, ctx, errors, `scene "${sb.id}"`);
    if (sb.type === "device") resolveDeviceRects(props, assetById, errors, `scene "${sb.id}"`);
    if (sb.type === "canvas") lastCanvas = { items: props.items ?? [], path: props.path ?? [] };
    let shots;
    if (sb.shots) {
      const res = compileShots(sb.shots, ctx);
      res.errors.forEach((e) => errors.push(`scene "${sb.id}" ${e}`));
      if (res.shots.length) shots = res.shots;
    }
    if (sb.type === "footage" && props.ramp?.length && assetById.get(props.asset)?.kind === "image") {
      const s2 = rampShots(props.ramp, shots, duration);
      if (s2.length) shots = s2;
    }
    if (sb.type === "sources" && !props.items?.length && props.auto !== false) props.items = sourceList(research, assets, libraryCredits);
    if (sb.type === "map") for (const h of props.highlight ?? []) {
      const id = resolveCountry(h.id);
      if (id) h.id = id; else errors.push(`scene "${sb.id}" map highlight: unknown country "${h.id}" (use a Natural Earth numeric id, ISO alpha-2 or English name)`);
    }
    for (const name of collectIcons([props, overlays])) {
      if (icons[name]) continue;
      const icon = resolveIcon(name);
      if (icon) icons[name] = icon; else errors.push(`scene "${sb.id}" uses unknown icon "${name}" (Lucide name or flag:<iso2>)`);
    }
    if (sb.type === "unit-grid" && !icons[props.icon ?? "user-round"]) { const icon = resolveIcon(props.icon ?? "user-round"); if (icon) icons[props.icon ?? "user-round"] = icon; }
    const refs = collectAssetRefs([props, overlays]);
    if (sb.backdrop) refs.add(sb.backdrop.asset);
    for (const id of refs) {
      const a = assetById.get(id);
      if (!a) { errors.push(`scene "${sb.id}" references unknown asset "${id}"`); continue; }
      if (!a.file) { errors.push(`asset "${id}" not fetched yet; run: onevideo assets fetch`); continue; }
      if (root && !existsSync(join(root, "public", a.file))) errors.push(`asset "${id}" file missing: public/${a.file}; run: onevideo assets fetch`);
      usedAssets[id] = { src: a.file, kind: a.kind, credit: credit(a) };
      // A full-page capture is this many of its viewport tall (what a scrolling screen slides over).
      const vp = a.capture?.full && a.capture.viewport;
      if (vp && a.width && a.height) usedAssets[id].pages = r3(a.height / a.width / (vp[1] / vp[0]));
      if (root && existsSync(join(root, "public", depthPath(a)))) {
        usedAssets[id].depth = depthPath(a);
        const meta = join(root, "public", depthPath(a), "meta.json");
        if (a.kind === "video" && existsSync(meta)) { const m = JSON.parse(readFileSync(meta, "utf8")); Object.assign(usedAssets[id], { depthStep: m.step, depthFrames: m.frames }); }
      }
      if (root && existsSync(join(root, "public", lumaPath(a)))) usedAssets[id].luma = lumaPath(a);
      if (a.kind === "video" && root) {
        const frames = countFrames(join(root, "public", framesDir(a.file)));
        if (frames) Object.assign(usedAssets[id], { seq: framesDir(a.file), frames, fps: 30 });
        else warnings.push(`asset "${id}": no frame sequence, falls back to <OffthreadVideo> (needs memory); run: onevideo render (extracts it)`);
      }
    }

    for (const l of lines) {
      captions.push({ scene: sb.id, text: l.text, start: r3(start + l.start), end: r3(start + l.end) });
      narration.push([r3(start + l.start), r3(start + l.end)]);
    }
    const chapter = sb.chapter ?? sc.chapter;
    if (chapter) chapters.push({ title: chapter, start: r3(start) });

    scenes.push({
      id: sb.id,
      type: sb.type,
      from,
      durationInFrames,
      start: r3(start),
      duration: r3(duration),
      audio: tm?.file ?? null,
      enter: sb.enter ?? null,
      exit: sb.exit ?? null,
      transitionIn: null,
      transitionOut: null,
      camera: { ...CAMERA_DEFAULT, ...(normCamera(theme.camera) ?? {}), ...(normCamera(sb.camera) ?? {}) },
      opaque: Boolean(sb.backdrop) || OPAQUE_TYPES.has(sb.type),
      header: sb.header ?? null,
      background: sb.background ?? null,
      backdrop: sb.backdrop ? { dim: 0.62, blur: 0, motion: "in", startFrom: 0, ...sb.backdrop } : null,
      captions: sb.captions !== false,
      cues,
      lines: lines.map((l) => ({ text: l.text, start: l.start, end: l.end })),
      props,
      ...(overlays.length ? { overlays } : {}),
      ...(shots ? { shots } : {}),
    });
    frame += durationInFrames;
  }

  const totalFrames = frame;
  // Opening fades up from the background, closing fades out; inner boundaries overlap.
  const edge = (type, d) => ({ type: type === "cut" ? "cut" : "fade", frames: type === "cut" ? 0 : Math.round(d * fps), lead: 0, direction: "left" });
  scenes.forEach((sc, i) => {
    const prev = scenes[i - 1];
    if (!prev) { sc.transitionIn = edge(normTransition(sc.enter)?.type ?? "fade", 0.45); return; }
    const b = boundaryTransition(prev, sc, theme, fps);
    sc.transitionIn = { type: b.type, frames: b.frames, lead: b.lead, direction: b.direction };
    prev.transitionOut = { type: b.type, frames: b.frames, tail: b.frames - b.lead, direction: b.direction, nextOpaque: sc.opaque };
    // Through dives at the outgoing subject: an authored [x, y] on screen, else the depth map's.
    if (b.type === "through") {
      const focus = b.focus ? { x: b.focus[0], y: b.focus[1], layer: "screen" } : subjectFocus(root, prev, usedAssets, fps, width, height);
      if (focus) sc.transitionIn.focus = prev.transitionOut.focus = focus;
    }
    const sound = b.sfx !== undefined ? b.sfx : transitionSfx(sfxCfg.transition, b.type);
    if (sound) sfx.push({ sound, src: sfxFile(sound), at: r3(Math.max(0, (sc.from - b.lead) / fps - 0.06)), volume: sfxCfg.volume * 0.7 });
  });
  // Text over media: a word without an authored x steps aside from the depth subject, and gets a
  // scrim when the background under it leaves less than 4.5:1.
  for (const sc of scenes) {
    for (const o of sc.overlays ?? []) {
      if (o.type !== "word") continue;
      const at = Math.min(sc.duration, o.t + 0.3);
      const d = depthAt(root, sc, usedAssets, fps, at);
      if (d && o.x === undefined) { const x = dodgeX(d, o, width, height); if (x !== null) o.x = x; }
      const g = o.scrim === undefined && lumaAt(root, sc, usedAssets, fps, at);
      if (g) {
        const bg = boxMean(g.px, g.w, g.h, wordBox(o, width, height), width, height) * (g.fill ? 1 : 1 - (sc.backdrop?.dim ?? 0));
        const k = scrimFor(hexLuminance(o.color ?? theme.colors?.text), bg);
        if (k) o.scrim = k;
      }
    }
    // A word still on screen when a later one lands on top of it leaves as that one arrives.
    const words = (sc.overlays ?? []).filter((o) => o.type === "word").sort((a, b) => a.t - b.t);
    for (const [i, a] of words.entries()) {
      const b = words.slice(i + 1).find((w) => w.t < a.end && overlaps(wordBox(a, width, height), wordBox(w, width, height)));
      if (b) a.end = r3(Math.max(a.t + 0.4, b.t));
    }
    // A footage title still up when a word lands on it fades out as the word arrives.
    const title = (sc.type === "footage" || sc.type === "parallax") && sc.props.title;
    if (title) {
      const t0 = title.t ?? 0.2, box = wordBox({ ...title, size: title.size ?? 260, y: title.y ?? 0.42 }, width, height);
      const hit = words.find((w) => w.t > t0 && w.t < t0 + (title.duration ?? Infinity) + 0.3 && overlaps(box, wordBox(w, width, height)));
      if (hit) title.duration = r3(Math.max(0.4, hit.t - t0 - 0.3));
    }
  }
  placeCaptions(scenes, captions, { root, usedAssets, fps, width, height });
  const last = scenes[scenes.length - 1];
  if (last) last.transitionOut = { type: normTransition(last.exit)?.type === "cut" ? "cut" : "fade", frames: normTransition(last.exit)?.type === "cut" ? 0 : Math.round(0.6 * fps), tail: 0, direction: "left", nextOpaque: false };
  if (sfxCfg.motion === "auto") {
    // Motion sounds yield to every authored / transition / overlay sound within 0.2 s, and to each other within 0.25 s.
    catalog ??= loadCatalog();
    const turn = {}, variants = {};
    let last = -Infinity;
    for (const c of scenes.flatMap(motionCues)) {
      if (c.at - last < 0.25 || sfx.some((s) => Math.abs(s.at - c.at) < 0.2)) continue;
      const cat = MOTION_SFX[c.role];
      const v = (variants[cat] ??= sfxVariants(cat, catalog));
      const sound = v[(turn[cat] = (turn[cat] ?? -1) + 1) % v.length];
      sfx.push({ sound, src: sfxFile(sound), at: c.at, volume: r3(sfxCfg.volume * MOTION_GAIN[c.role]), motion: c.role });
      last = c.at;
    }
  }
  sfx.sort((a, b) => a.at - b.at);
  // music.file is a path under public/ (own or licensed track); otherwise the synthesized bgm.wav.
  const music = config.music?.enabled === false ? null : root && existsSync(join(root, "public", musicSrc))
    ? { src: musicSrc, offset, volume: config.music?.volume ?? 0.22, duckTo: config.music?.duckTo ?? 0.07, fade: 1.2, credit: config.music?.file ? config.music?.credit ?? null : "OneVideo 程序化合成" }
    : null;
  if (config.music?.enabled !== false && !music) warnings.push(`no background music (public/${musicSrc})${config.music?.file ? "" : "; run: onevideo music"}`);
  if (config.music?.file && !config.music?.credit) warnings.push("music.file has no music.credit; add the track title/author/license for the publish credits");
  const usedSfx = [...new Set(sfx.map((s) => s.sound))];
  if (root) for (const name of usedSfx) if (!existsSync(join(root, "public", sfxFile(name)))) errors.push(`sfx "${name}" missing: public/${sfxFile(name)}; run: onevideo music`);
  // Library sounds run up to 8 s; the player keeps each one mounted for its real length.
  const sfxLen = {};
  if (root) for (const s of sfx) {
    const f = join(root, "public", s.src);
    if (sfxLen[s.src] === undefined && existsSync(f)) { try { sfxLen[s.src] = r3(parseWav(readFileSync(f)).duration); } catch { sfxLen[s.src] = null; } }
    if (sfxLen[s.src]) s.duration = sfxLen[s.src];
  }

  const timeline = {
    version: 1,
    title: script.title ?? config.title ?? "",
    fps,
    width,
    height,
    aspect: config.aspect ?? "16:9",
    totalFrames,
    duration: r3(totalFrames / fps),
    theme,
    watermark: config.watermark ?? null,
    captions: { enabled: config.captions?.enabled !== false, style: config.captions?.style ?? "line", items: captions },
    narration,
    music,
    sfx,
    chapters,
    assets: usedAssets,
    icons,
    // Only the variants overlays reference (a tinted copy replaces its untinted source).
    lottie: Object.fromEntries(Object.entries(lottie).filter(([k]) => scenes.some((sc) => sc.overlays?.some((o) => o.src === k)))),
    libraryCredits,
    look: config.look ?? theme.look ?? null,
    beats: music ? beats.filter((b) => b <= totalFrames / fps) : [],
    scenes,
  };
  return { timeline, errors, warnings };
}

// Style JSON nests colors/fonts/motion; a project's theme override merges one level deep.
export function mergeTheme(base, over = {}) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) out[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(base[k] ?? {}), ...v } : v;
  return out;
}
