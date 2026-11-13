// Vision prompt: review one contact sheet of a rendered video as a film editor.
// One sheet per call: relays cap a reply's tokens (reasoning included), so a whole-video review
// in one answer comes back cut off.
export const lookPrompt = ({ sheet: s, scenes, focus }) => `You are reviewing a rendered narrated video as a film editor. The image is a contact sheet: each cell is one frame, read row by row, left to right, cell 0 first. ${s.cells} cells; cell i shows about t = ${s.t0 + s.step / 2}s + i×${s.step}s${s.times ? " (moved a little off transitions and entrances, so most cells show settled frames)" : ""}, and each cell is stamped with its exact time in its top-left corner: use the stamp to say where you saw something.

Timeline around this stretch (scene id, type, start–end seconds, narration lines with their times, and "reveals": the moments a chart value, card or point is timed to appear, on the spoken word itself rather than the start of its line):
${scenes}

Visuals land on the word, not the line: a value that shows up at its reveal time is in sync even though its line began earlier, and cells ${s.step}s apart catch count-ups, line draws and fades mid-move. Do not report a value as late or missing when a reveal for it falls within ~${Math.max(1, s.step)}s after the cell.
Judge what a viewer sees: stretches where nothing new happens on screen (more than ~4 s), text that is hard to read or collides with other text or covers the subject, awkward composition or cropping, a visual that does not match its narration line, jarring or repetitive transitions, blank/black/broken frames, inconsistent look between scenes. Ignore things that are fine. ${focus ? `Pay extra attention to: ${focus}.` : ""}
Tag each note: kind "still" when nothing new happens on screen (give span: the stretch you mean), "late" when something shows up after its narration or is missing, "other" for anything else; span is optional for other kinds.
Keep it short: at most 5 notes, the most important first, each issue and fix under 40 characters.
Reply only JSON: {"score": <1-10 for this stretch>, "summary": "<one sentence, Chinese>", "notes": [{"t": <seconds stamped on the cell>, "cell": <i>, "severity": "high|medium|low", "kind": "still|late|other", "span": [<from s>, <to s>], "issue": "<Chinese>", "fix": "<concrete change, Chinese>"}]}`;

// A timeline scene as one prompt line: id, type, span and its narration lines with times.
// Resolved cues become "reveals": when a cued element appears, so a vision model does not expect it at the line's start.
export const sceneLine = (s) => {
  const reveals = [...new Set(Object.values(s.cues ?? {}).filter((t) => Number.isFinite(t) && t > 0.05).map((t) => (s.start + t).toFixed(1)))].sort((a, b) => a - b);
  return `- ${s.id} (${s.type}) ${s.start.toFixed(1)}–${(s.start + s.duration).toFixed(1)}s: ${(s.lines ?? []).map((l) => `[${(s.start + l.start).toFixed(1)}s] ${l.text}`).join(" ")}${reveals.length ? ` · reveals at ${reveals.join(", ")}s` : ""}`;
};
