// The director's eyes on a render: contact sheets (every Nth second tiled into one image), the
// same against an earlier version, and a second opinion from a vision model that reads them
// against the timeline.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { UserError, loadProject, readJson, writeJson, log, warn } from "../lib/core/project.mjs";
import { ask, imagePart, llmConfig } from "../lib/llm/client.mjs";
import { lookPrompt, sceneLine } from "../lib/prompts/index.mjs";
import { busyWindows, cellTime, sceneAt, sheetPlan, writeSheets } from "../lib/vision/sheet.mjs";
import { resolveVideo } from "../lib/publish/renders.mjs";
import { videoPath } from "./render.mjs";
import { checkNotes, checkTone, meanLuma, median, mergePasses, toneOf } from "../lib/review/look-check.mjs";
import { frameRgb } from "../lib/vision/screen.mjs";
import { pool } from "../lib/core/http.mjs";
import { buildHandoff, handoffPath, handoffRel } from "../lib/publish/handoff.mjs";

export { sceneAt, sheetPlan, writeSheets };

// The video to read: --video (v3, prev, a path) or the newest render; a part render starts later
// on the timeline, so its cells are shifted by its offset when they are matched to scenes.
function target(project, arg) {
  const v = resolveVideo(project, arg, videoPath(project));
  if (!existsSync(v.file)) throw new UserError(`no video at ${v.file}; run: onevideo render`);
  return v;
}
const range = (args, offset) => ({ from: Math.max(0, Number(args.from ?? offset) - offset), to: args.to !== undefined ? Number(args.to) - offset : undefined });

export async function sheet(args) {
  const project = loadProject();
  const cur = target(project, args.video);
  const tl = existsSync(project.paths.timeline) ? readJson(project.paths.timeline) : null;
  // --vs v3: each cell shows that version on top and this one below, at the same timeline moment.
  const vs = args.vs !== undefined ? target(project, args.vs) : null;
  const { sheets } = await writeSheets(cur.file, join(project.paths.out, "qc"), {
    fps: args.fps !== undefined ? Number(args.fps) : undefined, ...range(args, cur.offset), shift: cur.offset,
    cols: Number(args.cols ?? (vs ? 4 : 6)), width: Number(args.width ?? 480),
    ...(vs ? { prefix: "compare", pair: { video: vs.file, shift: cur.offset - vs.offset } } : {}),
  });
  const name = (v) => (v.entry ? `v${v.entry.v}` : relative(project.root, v.file));
  if (vs) log(`top: ${name(vs)} · bottom: ${name(cur)}`);
  for (const s of sheets) {
    const t0 = +(s.t0 + cur.offset).toFixed(3);
    log(`✓ ${relative(project.root, s.file)}  ${s.cols}×${s.rows}, cell i = ${+(t0 + s.step / 2).toFixed(2)}s + i×${s.step}s`);
    // Where each scene starts on the sheet, so a cell can be named without counting.
    const marks = (tl?.scenes ?? []).map((sc) => [sc.id, Math.ceil((sc.start - t0) / s.step - 0.5)]).filter(([, i]) => i >= 0 && i < s.cells);
    if (marks.length) log(`  scenes from cell: ${marks.map(([id, i]) => `${id}@${i}`).join("  ")}`);
  }
}

export async function look(args) {
  const project = loadProject();
  const { file: video, offset } = target(project, args.video);
  const tl = existsSync(project.paths.timeline) ? readJson(project.paths.timeline) : null;
  const outDir = join(project.paths.out, "qc");
  // Cells are nudged off transitions and entrances: half-drawn frames were most of look's false alarms.
  const busy = busyWindows(tl).map(([a, b]) => [a - offset, b - offset]);
  const { sheets: raw } = await writeSheets(video, outDir, { fps: args.fps !== undefined ? Number(args.fps) : undefined, ...range(args, offset), width: 400, shift: offset, busy });
  // Timeline time from here on: a part render's cells are shifted by where it starts.
  const sheets = raw.map((s) => ({ ...s, t0: +(s.t0 + offset).toFixed(3), times: s.times?.map((t) => +(t + offset).toFixed(2)) }));
  const config = { llm: { ...project.config.llm, ...(args.models ? { models: String(args.models).split(",") } : {}) } };
  // Each sheet is read by `--passes` different models at once: the model list is dealt out between
  // the passes (1st, 3rd… model to pass 1; 2nd, 4th… to pass 2), each falling back within its own share.
  // The score is their median and a note one pass alone raised is shown as such.
  const models = llmConfig(config).models;
  const passes = Math.max(1, Math.min(models.length, Number(args.passes ?? 2)));
  const shares = Array.from({ length: passes }, (_, p) => models.filter((_, i) => i % passes === p));
  // Sheets are reviewed side by side too (`--jobs`, default 3).
  const jobs = Math.max(1, Number(args.jobs ?? 3));
  log(`look: ${sheets.length} sheet(s) × ${passes} pass(es), ${jobs} sheet(s) at a time → ${shares.map((m) => m.join(" / ")).join("  |  ")}`);
  const reviews = [], notes = [];
  const done = await pool(sheets, jobs, async (s, k) => {
    const end = s.t0 + s.cells * s.step;
    const scenes = (tl?.scenes ?? []).filter((sc) => sc.start < end && sc.start + sc.duration > s.t0).map(sceneLine).join("\n") || "(no timeline)";
    const pass = async (share, p) => {
      // An empty answer (no score, no notes) does not count: the next model in this share is asked.
      for (let from = 0; from < share.length; from++) {
        try {
          const { data, model } = await ask({ prompt: lookPrompt({ sheet: s, scenes, focus: args.focus }), images: [imagePart(s.file)], json: true, maxTokens: 4000, config: { llm: { ...config.llm, models: share.slice(from) } } });
          if (!Number(data.score) && !(Array.isArray(data.notes) && data.notes.length)) { warn(`sheet ${k + 1}.${p + 1}: empty review from ${model}; asking the next model`); from = share.indexOf(model); continue; }
          const run = { model, score: Number(data.score) || null, summary: String(data.summary ?? ""), truncated: !!data.truncated, notes: [] };
          // A note cut off before its issue says nothing.
          for (const n of Array.isArray(data.notes) ? data.notes : []) {
            if (!String(n.issue ?? "").trim()) continue;
            // The stamped time read off the cell, snapped to it; the cell index only when no usable time came back.
            const read = Number(n.t), c = Number.isFinite(read) && read >= s.t0 && read <= s.t0 + s.cells * s.step ? Math.floor((read - s.t0) / s.step) : Number(n.cell) || 0;
            const t = cellTime(s, Math.max(0, Math.min(s.cells - 1, c)));
            run.notes.push({ t, scene: sceneAt(tl, t), severity: ["high", "medium", "low"].includes(n.severity) ? n.severity : "medium", ...(typeof n.kind === "string" && { kind: n.kind }), ...(Array.isArray(n.span) && { span: n.span }), issue: String(n.issue), fix: String(n.fix ?? ""), model });
          }
          log(`  sheet ${k + 1}.${p + 1}: ${data.score ?? "?"}/10 (${model})${data.truncated ? " [reply cut off; kept complete notes]" : ""} ${data.summary ?? ""}`);
          return run;
        } catch (e) {
          warn(`sheet ${k + 1}.${p + 1}: ${e.message}`);
          return null; // ask() has already walked the rest of this share
        }
      }
      return null;
    };
    const runs = (await Promise.all(shares.map(pass))).filter(Boolean);
    if (!runs.length) return null;
    const merged = mergePasses(runs, { near: Math.max(2, s.step * 1.5) });
    return { review: { sheet: relative(project.root, s.file), score: merged.score, passes: runs.map(({ notes: _, ...r }) => r) }, notes: merged.notes.map((n) => (runs.length > 1 ? { ...n, of: runs.length } : n)) };
  });
  for (const d of done.filter(Boolean)) { reviews.push(d.review); notes.push(...d.notes); }
  if (!reviews.length) throw new UserError("no sheet was reviewed; check the model list (onevideo doctor) or pass --models");
  notes.sort((a, b) => a.t - b.t);
  // "Nothing changes here" and "shows up late" are checked against the timeline's own events.
  let doubtful = checkNotes(tl, notes);
  // "Too dark", "too bright", "a jarring jump in level": measured on the frames, against the video's own level.
  const toned = notes.filter((n) => !n.check && toneOf(n));
  if (toned.length) {
    const level = async (t) => meanLuma((await frameRgb(video, { t: Math.max(0, t - offset), width: 96 })).rgb);
    const span = tl?.duration ?? sheets.at(-1).t0 + sheets.at(-1).cells * sheets.at(-1).step;
    const at = [];
    for (let t = offset + 1; t < span; t += Math.max(2, span / 40)) at.push(t);
    const mid = median(await pool(at, 4, (t) => level(t).catch(() => NaN)));
    for (const n of toned) {
      const sc = tl?.scenes?.find((x) => x.id === n.scene);
      const tone = toneOf(n);
      const at = tone === "jump" && sc ? sc.start + Math.min(1, sc.duration / 2) : n.t;
      const before = tone === "jump" && sc && sc.start - 0.5 > offset ? await level(sc.start - 0.5).catch(() => NaN) : NaN;
      const check = checkTone(tone, { luma: await level(at).catch(() => NaN), median: mid, before });
      if (!check) continue;
      n.check = check;
      if (check.doubtful) doubtful++;
    }
  }
  const scored = reviews.filter((r) => r.score);
  const score = scored.length ? +(scored.reduce((a, r) => a + r.score, 0) / scored.length).toFixed(1) : null;
  const result = { at: new Date().toISOString(), video: relative(project.root, video), score, reviews, notes };
  writeJson(join(outDir, "look.json"), result);
  log(`score ${score ?? "?"}/10 over ${reviews.length}/${sheets.length} sheet(s)`);
  const icon = { high: "✗", medium: "⚠", low: "·" };
  for (const n of notes) log(`${n.check?.doubtful ? "?" : icon[n.severity]} ${n.t.toFixed(1).padStart(5)}s ${String(n.scene ?? "").padEnd(10)} ${n.of ? `[${n.seen}/${n.of}] ` : ""}${n.issue}${n.fix ? `\n         → ${n.fix}` : ""}${n.check?.doubtful ? `\n         ? ${n.check.why}` : ""}`);
  const lone = notes.filter((n) => n.of && n.seen < 2).length;
  if (lone) log(`[1/${passes}] ${lone} note(s) only one model raised: weigh them lower than the ones several agree on`);
  if (doubtful) log(`? ${doubtful} note(s) the timeline contradicts: check those stills before acting on them`);
  if (!notes.length) warn("no notes returned; check the sheets yourself");
  log(`→ ${relative(project.root, join(outDir, "look.json"))} (a second opinion: confirm on the sheets or with stills before changing the storyboard)`);
}

// Before switching sessions or handing a round to a subagent: write down where the cut stands.
export async function handoff(args) {
  const project = loadProject();
  const md = buildHandoff(project, { lock: typeof args.lock === "string" ? args.lock : undefined, next: typeof args.next === "string" ? args.next : undefined });
  mkdirSync(join(project.root, "plan"), { recursive: true });
  writeFileSync(handoffPath(project), md);
  log(`→ ${handoffRel(project)} (hand-written: 锁定 / 下一轮只改 / 备注 — edit them there or with --lock / --next)`);
}
