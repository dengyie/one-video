// WebVTT → cues for the player's transcript (index.html imports it; tests/web-vtt.test.mjs tests it).
// Lenient: BOM, CRLF, cue identifiers, mm:ss.mmm or hh:mm:ss.mmm, cue settings, NOTE / STYLE /
// REGION blocks, inline tags (<b>, <v Name>, <00:01.000>) and the common character references.

const TIME = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/;
const ENTITY = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&lrm;": "", "&rlm;": "", "&quot;": '"', "&#39;": "'" };

export function seconds(s) {
  const m = TIME.exec(s.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
}

// → [{ start, end, text }] in file order, empty cues dropped.
export function parseVtt(src) {
  const blocks = String(src ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0 || at > 1) continue; // header, NOTE / STYLE / REGION, or not a cue
    const [a, rest = ""] = lines[at].split("-->");
    const start = seconds(a);
    const end = seconds(rest.trim().split(/\s+/)[0] ?? "");
    if (start == null || end == null) continue;
    const text = lines.slice(at + 1).join(" ")
      .replace(/<[^>]*>/g, "")
      .replace(/&(?:amp|lt|gt|nbsp|lrm|rlm|quot|#39);/g, (e) => ENTITY[e])
      .replace(/\s+/g, " ")
      .trim();
    if (text) cues.push({ start, end: Math.max(start, end), text });
  }
  return cues;
}

// Index of the cue being heard at `t`: the last one started by then (a pause between cues keeps
// the previous line lit), or -1 before the first.
export function cueAt(cues, t) {
  let lo = 0, hi = cues.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t + 0.05) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}
