// Caption lines: how narration is cut into on-screen lines. Each line is also one TTS unit (or one
// pause-aligned slice of the scene audio), so the cut decides caption timing too.
import { visualLength } from "../core/text.mjs";

const SENTENCE_END = /[。！？!?；;…]/;
const CLAUSE_END = /[，,、：:]/;
const TRAILING = /[。！？!?；;…，,、：:\s]+$/u;

// Portrait as the engine decides it (height ≥ 1.5 × width), so a custom width/height counts too.
export function captionMaxChars(config) {
  const portrait = config.width && config.height ? config.height >= config.width * 1.5 : config.aspect === "9:16";
  return config.captions?.maxChars ?? (portrait ? 13 : 22);
}

// Resolve a scene's narration into caption/TTS lines.
export function sceneLines(scene, config) {
  if (Array.isArray(scene.lines)) return scene.lines.map((l) => (typeof l === "string" ? { text: l, pause: "sentence" } : { pause: "sentence", ...l }));
  if (!scene.narration) return [];
  return splitLines(scene.narration, captionMaxChars(config));
}

// Split narration into caption lines; each line is also one TTS request,
// so its measured audio duration gives exact caption timing.
export function splitLines(text, maxChars = 24) {
  const lines = [];
  for (const sentence of chunk(text, SENTENCE_END)) {
    const pause = "sentence";
    if (visualLength(sentence) <= maxChars) { push(lines, sentence, pause); continue; }
    let cur = "";
    const clauses = chunk(sentence, CLAUSE_END);
    clauses.forEach((c, i) => {
      if (cur && visualLength(cur + c) > maxChars) { flushLong(lines, cur, maxChars, "clause"); cur = c; }
      else cur += c;
      if (i === clauses.length - 1) flushLong(lines, cur, maxChars, pause);
    });
  }
  return lines;
}

function chunk(text, re) {
  const out = [];
  let cur = "";
  for (const ch of text.replace(/\s*\n\s*/g, "")) {
    cur += ch;
    if (re.test(ch)) { out.push(cur); cur = ""; }
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function push(lines, raw, pause) {
  const text = raw.replace(TRAILING, "").trim();
  if (text) lines.push({ text, pause });
}

// A clause longer than maxChars is cut at the last safe boundary (never inside a Latin word or number).
function flushLong(lines, s, maxChars, pause) {
  let rest = s;
  while (visualLength(rest.replace(TRAILING, "")) > maxChars) {
    const chars = [...rest];
    let cut = 0, w = 0;
    for (let i = 0; i < chars.length; i++) {
      w += visualLength(chars[i]);
      if (w > maxChars) break;
      const a = chars[i], b = chars[i + 1] ?? "";
      if (!(/[A-Za-z0-9.%]/.test(a) && /[A-Za-z0-9.%]/.test(b))) cut = i + 1;
    }
    if (cut === 0) cut = Math.max(1, Math.floor(chars.length / 2));
    push(lines, chars.slice(0, cut).join(""), "clause");
    rest = chars.slice(cut).join("");
  }
  push(lines, rest, pause);
}
