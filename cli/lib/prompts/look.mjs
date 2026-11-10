// Vision prompt: review one contact sheet of a rendered video as a film editor.
// One sheet per call: relays cap a reply's tokens (reasoning included), so a whole-video review
// in one answer comes back cut off.
export const lookPrompt = ({ sheet: s, scenes, focus }) => `You are reviewing a rendered narrated video as a film editor. The image is a contact sheet: each cell is one frame, read row by row, left to right, cell 0 first. ${s.cells} cells; cell i shows t = ${s.t0 + s.step / 2}s + i×${s.step}s.

Timeline around this stretch (scene id, type, start–end seconds, narration lines with their times):
${scenes}

Judge what a viewer sees: stretches where nothing new happens on screen (more than ~4 s), text that is hard to read or collides with other text or covers the subject, awkward composition or cropping, a visual that does not match its narration line, jarring or repetitive transitions, blank/black/broken frames, inconsistent look between scenes. Ignore things that are fine. ${focus ? `Pay extra attention to: ${focus}.` : ""}
Keep it short: at most 5 notes, the most important first, each issue and fix under 40 characters.
Reply only JSON: {"score": <1-10 for this stretch>, "summary": "<one sentence, Chinese>", "notes": [{"cell": <i>, "severity": "high|medium|low", "issue": "<Chinese>", "fix": "<concrete change, Chinese>"}]}`;

// A timeline scene as one prompt line: id, type, span and its narration lines with times.
export const sceneLine = (s) => `- ${s.id} (${s.type}) ${s.start.toFixed(1)}–${(s.start + s.duration).toFixed(1)}s: ${(s.lines ?? []).map((l) => `[${(s.start + l.start).toFixed(1)}s] ${l.text}`).join(" ")}`;
