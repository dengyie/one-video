// Caption lines: how narration is cut into on-screen lines. Each line is also one TTS unit (or one
// pause-aligned slice of the scene audio), so the cut decides caption timing too.
import { visualLength } from "../core/text.mjs";

const SENTENCE_END = /[。！？!?；;…]/;
const CLAUSE_END = /[，,、：:]/;
const TRAILING = /[。！？!?；;…，,、：:\s]+$/u;
const TOKEN = /[A-Za-z][A-Za-z\d]*(?:[.-][A-Za-z\d]+)*|\d+(?:[.,]\d+)*(?:%|(?:万亿|亿|万)?(?:美元|元)|万亿|亿|万)?/g;
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });

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
  const chars = [...text.replace(/\s*\n\s*/g, "")];
  for (const [i, ch] of chars.entries()) {
    cur += ch;
    const numericComma = ch === "," && /\d/.test(chars[i - 1] ?? "") && /\d/.test(chars[i + 1] ?? "");
    if (!numericComma && re.test(ch)) { out.push(cur); cur = ""; }
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function push(lines, raw, pause) {
  const text = raw.replace(TRAILING, "").trim();
  if (text) lines.push({ text, pause });
}

// Keep fitting Latin words and numbers intact, and rebalance a short tail of a forced wrap.
function flushLong(lines, s, maxChars, pause) {
  let rest = s.replace(TRAILING, "").trim();
  while (visualLength(rest) > maxChars) {
    const chars = [...rest];
    const protectedCuts = new Set();
    for (const m of rest.matchAll(TOKEN)) {
      for (let k = m.index + 1; k < m.index + m[0].length; k++) protectedCuts.add(k);
    }
    const safe = [];
    let w = 0, limit = 0;
    for (const ch of chars) {
      w += visualLength(ch);
      if (w > maxChars) break;
      limit += ch.length;
      if (!protectedCuts.has(limit)) safe.push(limit);
    }
    let cut = safe.at(-1) ?? (limit || chars[0].length);
    if (visualLength(rest.slice(cut).trim()) <= 2) {
      const min = Math.min(4, maxChars / 3);
      const balanced = safe.filter((k) => {
        const tail = visualLength(rest.slice(k).trim());
        return tail >= min && tail <= maxChars && visualLength(rest.slice(0, k).trim()) >= min;
      });
      const words = new Set(Array.from(segmenter.segment(rest), ({ index }) => index));
      cut = balanced.findLast((k) => words.has(k)) ?? balanced.at(-1) ?? cut;
    }
    push(lines, rest.slice(0, cut), "clause");
    rest = rest.slice(cut).trimStart();
  }
  push(lines, rest, pause);
}
