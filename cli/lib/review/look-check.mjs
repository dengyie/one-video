// Checks look's notes against the compiled timeline. A vision model reading a contact sheet sees
// one frame every second or two, so "nothing changes here" and "this shows up late" are its most
// common false alarms; the timeline knows every reveal, shot and overlay. A note the timeline
// contradicts is kept but marked doubtful, with what the timeline has there.
import { screenEvents } from "./gates.mjs";

// Wording about the frame not changing; "偏空" (sparse) or "单调" (same backdrop) are about composition, not events.
const STILL = /静止|无变化|没有变化|无新|没有新|空档|空白|长时间不变/;
const LATE = /才出现|未显示|没显示|没有出现|未出现|滞后|延迟|晚了|偏晚|缺少画面|无对应|无画面/;

// What kind of claim a note makes: the model's own `kind` when it gave one, else read off the wording.
export function noteKind(n) {
  if (["still", "late", "other"].includes(n.kind)) return n.kind;
  const text = `${n.issue ?? ""}`;
  if (STILL.test(text)) return "still";
  if (LATE.test(text)) return "late";
  return "other";
}

// The stretch a "still" note is about: its span, or one written in the issue ("33-37s", "103–111秒"),
// when it covers t; else 2s each side.
const SPAN = /(\d+(?:\.\d+)?)\s*[-–~至到]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)/;
function window(n) {
  const said = `${n.issue ?? ""}`.match(SPAN);
  const [a, b] = Array.isArray(n.span) ? n.span.map(Number) : said ? [Number(said[1]), Number(said[2])] : [];
  if (Number.isFinite(a) && Number.isFinite(b) && b - a >= 1 && b - a <= 20 && a <= n.t + 1 && b >= n.t - 1) return [a, b];
  return [n.t - 2, n.t + 2];
}

// Marks each note { check: { doubtful, why } } in place and returns how many the timeline contradicts.
// still: the timeline has a real change (not a weak shot) at least every `maxGap` seconds across the stretch.
// late:  a cue reveal or overlay entrance lands within `lead` seconds after the cell: it is timed on its word.
export function checkNotes(timeline, notes, { maxGap = 3, lead = 3 } = {}) {
  if (!timeline?.scenes?.length) return 0;
  const all = screenEvents(timeline).filter((e) => !e.weak);
  let doubtful = 0;
  for (const n of notes) {
    // Only the note's own scene: the next scene starting is not evidence that this one moves.
    const events = n.scene ? all.filter((e) => e.scene === n.scene) : all;
    const kind = noteKind(n);
    if (kind === "still") {
      const [a, b] = window(n);
      const inside = events.filter((e) => e.t > a && e.t < b);
      const marks = [a, ...inside.map((e) => e.t), b];
      const gap = Math.max(...marks.slice(1).map((t, i) => t - marks[i]));
      n.check = gap <= maxGap && inside.length
        ? { doubtful: true, why: `timeline changes at ${inside.map((e) => `${e.t.toFixed(1)}s ${e.what}`).join(", ")}` }
        : { doubtful: false, why: `${gap.toFixed(1)}s without a change in ${a.toFixed(1)}–${b.toFixed(1)}s` };
    } else if (kind === "late") {
      const hit = events.find((e) => (e.what === "cue" || e.what === "overlay") && e.t > n.t - 0.3 && e.t <= n.t + lead);
      n.check = hit ? { doubtful: true, why: `a ${hit.what} reveals at ${hit.t.toFixed(1)}s, on its word` } : { doubtful: false, why: "no reveal timed just after" };
    } else continue;
    if (n.check.doubtful) doubtful++;
  }
  return doubtful;
}

// Several reviews of one sheet, each from a different model: scores vary by a point or more between
// runs and a single run invents notes, so the score is the median and a note counts once per pass
// that raised it. Two notes are the same point when they sit in the same scene within `near` seconds
// and make the same kind of claim; the most severe wording is kept. Returns { score, notes } with
// `seen` (passes that raised it) on each note.
const RANK = { high: 3, medium: 2, low: 1 };
export const median = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
};
export function mergePasses(passes, { near = 2 } = {}) {
  const notes = [];
  passes.forEach((p, k) => {
    for (const n of p.notes) {
      const same = notes.find((m) => !m.passes.has(k) && m.scene === n.scene && Math.abs(m.t - n.t) <= near && noteKind(m) === noteKind(n));
      if (!same) { notes.push({ ...n, passes: new Set([k]) }); continue; }
      same.passes.add(k);
      if (RANK[n.severity] > RANK[same.severity]) Object.assign(same, { ...n, t: same.t, passes: same.passes });
    }
  });
  return {
    score: median(passes.map((p) => p.score)),
    notes: notes.map(({ passes: s, ...n }) => ({ ...n, seen: s.size })).sort((a, b) => a.t - b.t),
  };
}

// Brightness claims, checked on the frames themselves. Runs of the same video were seen to call one
// scene both too dark and too bright, so a claim is held against the video's own level:
// dark/bright against the median of frames sampled across the video, a jump against the frame just
// before the scene began. `luma` is 0–1 (Rec. 709 mean).
const DARK = /太暗|偏暗|过暗|昏暗|发黑|看不清.*暗/;
const BRIGHT = /太亮|偏亮|过亮|过曝|刺眼|发白/;
const JUMP = /反差|突兀|跳变|亮度.*(变化|跳)|明暗.*(突变|跳)/;
export function toneOf(n) {
  const text = `${n.issue ?? ""}`;
  if (JUMP.test(text) && /亮|暗|明/.test(text)) return "jump";
  if (DARK.test(text)) return "dark";
  if (BRIGHT.test(text)) return "bright";
  return null;
}
export const meanLuma = (rgb) => {
  let sum = 0;
  for (let i = 0; i + 2 < rgb.length; i += 3) sum += 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
  return sum / (rgb.length / 3) / 255;
};
// { luma, median, before } → the check for one note of tone `tone`. `jumpMin`: a change in mean
// level smaller than this between scenes is not a jump; `margin`: how far past the median counts.
export function checkTone(tone, { luma, median: mid, before }, { jumpMin = 0.08, margin = 0.02 } = {}) {
  if (!Number.isFinite(luma) || !Number.isFinite(mid)) return null;
  const pct = (v) => `${Math.round(v * 100)}%`;
  if (tone === "dark") return luma >= mid - margin
    ? { doubtful: true, why: `frame level ${pct(luma)} is no darker than the video's median ${pct(mid)}` }
    : { doubtful: false, why: `frame level ${pct(luma)} vs median ${pct(mid)}` };
  if (tone === "bright") return luma <= mid + margin
    ? { doubtful: true, why: `frame level ${pct(luma)} is no brighter than the video's median ${pct(mid)}` }
    : { doubtful: false, why: `frame level ${pct(luma)} vs median ${pct(mid)}` };
  if (tone === "jump" && Number.isFinite(before)) return Math.abs(luma - before) < jumpMin
    ? { doubtful: true, why: `level ${pct(before)} → ${pct(luma)} across the cut: no real jump` }
    : { doubtful: false, why: `level ${pct(before)} → ${pct(luma)} across the cut` };
  return null;
}
