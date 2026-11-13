// Checks look's notes against the compiled timeline. A vision model reading a contact sheet sees
// one frame every second or two, so "nothing changes here" and "this shows up late" are its most
// common false alarms; the timeline knows every reveal, shot and overlay. A note the timeline
// contradicts is kept but marked doubtful, with what the timeline has there.
import { screenEvents } from "./gates.mjs";

const STILL = /静止|无变化|没有变化|无新|没有新|空档|空白|偏空|单调|停留过久|长时间不变/;
const LATE = /才出现|未显示|没显示|没有出现|未出现|滞后|延迟|晚了|偏晚|缺少画面|无对应|无画面/;

// What kind of claim a note makes: the model's own `kind` when it gave one, else read off the wording.
export function noteKind(n) {
  if (["still", "late", "other"].includes(n.kind)) return n.kind;
  const text = `${n.issue ?? ""}`;
  if (STILL.test(text)) return "still";
  if (LATE.test(text)) return "late";
  return "other";
}

// The stretch a "still" note is about: its span when it named one (and the span covers t), else 2s each side.
function window(n) {
  const [a, b] = Array.isArray(n.span) ? n.span.map(Number) : [];
  if (Number.isFinite(a) && Number.isFinite(b) && b - a >= 1 && b - a <= 20 && a <= n.t + 1 && b >= n.t - 1) return [a, b];
  return [n.t - 2, n.t + 2];
}

// Marks each note { check: { doubtful, why } } in place and returns how many the timeline contradicts.
// still: the timeline has a real change (not a weak shot) at least every `maxGap` seconds across the stretch.
// late:  a cue reveal or overlay entrance lands within `lead` seconds after the cell: it is timed on its word.
export function checkNotes(timeline, notes, { maxGap = 3, lead = 3 } = {}) {
  if (!timeline?.scenes?.length) return 0;
  const events = screenEvents(timeline).filter((e) => !e.weak);
  let doubtful = 0;
  for (const n of notes) {
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
