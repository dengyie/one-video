// Cues: when something happens inside a scene, from a spoken phrase, seconds or a music beat.
import { normalizeForMatch, spokenLength } from "../core/text.mjs";

// Phrase cues fire this much before the word is spoken: the eye should land on a number as the
// voice says it, and a reveal takes a few frames to read.
export const CUE_LEAD = 0.2;

// Find a phrase across a scene's caption lines and return its spoken time (scene-relative).
// Time inside a line is interpolated by spoken syllables (a digit takes longer to say than it
// takes to write), which is accurate to ~0.2s for TTS speech.
export function phraseTime(lines, phrase) {
  const needle = normalizeForMatch(phrase);
  if (!needle) return null;
  const map = [];
  let hay = "";
  lines.forEach((l, li) => {
    const n = normalizeForMatch(l.text);
    for (let i = 0; i < n.length; i++) map.push([li, i, n.length]);
    hay += n;
  });
  const idx = hay.indexOf(needle);
  if (idx < 0) return null;
  const [li, pos] = map[idx];
  const l = lines[li];
  const n = normalizeForMatch(l.text);
  const share = spokenLength(n.slice(0, pos)) / Math.max(1e-6, spokenLength(n));
  return l.start + (l.end - l.start) * (Number.isFinite(share) ? Math.min(1, share) : 0);
}

export function resolveAt(at, lines, duration) {
  if (typeof at === "number") return { t: at < 0 ? duration + at : at };
  const spec = typeof at === "string" ? { phrase: at, offset: 0 } : at ?? {};
  if (typeof spec.phrase !== "string") return { error: `invalid cue ${JSON.stringify(at)}` };
  const t = phraseTime(lines, spec.phrase);
  if (t === null) return { error: `phrase "${spec.phrase}" not found in narration` };
  return { t: t - CUE_LEAD + (spec.offset ?? 0) };
}

// When something happens inside a scene: a named cue, a phrase / seconds (`at`), or the nth
// music beat counted from the scene start ({ beat: n }). Returns scene-relative seconds.
export function resolveWhen(spec, { cues, lines, duration, start = 0, beats = [] }) {
  if (spec?.cue !== undefined) return cues[spec.cue] !== undefined ? { t: cues[spec.cue] + (spec.offset ?? 0) } : { error: `unknown cue "${spec.cue}"` };
  const at = spec?.at ?? 0;
  if (at && typeof at === "object" && at.beat !== undefined) {
    const local = beats.filter((b) => b >= start - 1e-3).map((b) => b - start);
    return local[at.beat] !== undefined ? { t: local[at.beat] + (at.offset ?? 0) } : { error: `beat ${at.beat} is past the music` };
  }
  return resolveAt(at, lines, duration);
}
