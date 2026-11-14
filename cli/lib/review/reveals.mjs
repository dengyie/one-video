// Chart elements the narration says by number: a cue to pin each one's reveal on the words that say it.
// Reads a compiled timeline scene (props with cue names, caption lines); the cues it proposes go
// into the storyboard as phrases.
import { normalizeForMatch, parseNumber } from "../core/text.mjs";
import { CUE_LEAD, phraseTime } from "../timeline/cues.mjs";

// Same tokens as extractNumbers; dates and counts of years are not values a chart shows.
const NUMBER = /\d+(?:[.,]\d+)*(?:万亿|亿|万|千|百|%|倍|年|月|日|美元|元)?/g;
const DATE = new Set(["年", "月", "日"]);
const TOLERANCE = 0.02;

// What a chart reveals one by one: each element's value, its cue (if any) and where a cue goes.
function elements(type, p = {}) {
  const list = (arr, key, field = "value") => (Array.isArray(arr) ? arr : []).map((x, i) => ({ value: x?.[field], cue: x?.cue, path: ["props", key, i, "cue"] }));
  switch (type) {
    case "stat-cards": return list(p.cards, "cards");
    case "bar-compare":
    case "scale-compare": return list(p.items, "items");
    case "unit-grid": return list(p.groups, "groups", "count");
    case "compare": return ["left", "right"].filter((k) => p[k]).map((k) => ({ value: p[k].value, cue: p[k].cue, path: ["props", k, "cue"] }));
    case "share": {
      // A spoken total is the ring's sum; with no total row yet, one is added for it.
      const sum = (p.segments ?? []).reduce((s, x) => s + (Number(x?.value) || 0), 0);
      return [...list(p.segments, "segments"), p.total ? { value: sum, cue: p.total.cue, path: ["props", "total", "cue"] } : { value: sum, path: ["props", "total"], row: true }];
    }
    default: return [];
  }
}

const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b !== 0 && Math.abs(Math.abs(a) - Math.abs(b)) <= TOLERANCE * Math.abs(b);

// Numbers spoken in the scene, in order: amount, the shortest phrase that finds this occurrence
// (a cue phrase resolves to its first match), and the scene time the cue would fire.
function spoken(sc) {
  const lines = sc.lines ?? [];
  const hay = lines.map((l) => normalizeForMatch(String(l.text ?? ""))).join("");
  const out = [];
  for (const m of hay.matchAll(NUMBER)) {
    const n = parseNumber(m[0]);
    if (!n || DATE.has(n.unit)) continue;
    let phrase = null;
    for (let k = 0; k <= 4 && k <= m.index && !phrase; k++) {
      const p = hay.slice(m.index - k, m.index + m[0].length);
      if (hay.indexOf(p) === m.index - k) phrase = p;
    }
    const t = phrase && phraseTime(lines, phrase);
    if (Number.isFinite(t)) out.push({ amount: n.amount, phrase, t: Math.max(0, t - CUE_LEAD) });
  }
  return out;
}

// { cues: {name: phrase}, refs: [{path, value}], times: [scene seconds] } for the elements of `sc`
// with no cue whose value the narration says, or null when there is none.
export function numberReveals(sc) {
  if (!sc?.props) return null;
  const said = spoken(sc);
  if (!said.length) return null;
  const taken = new Set(Object.keys(sc.cues ?? {}));
  const name = () => { let k = 1; while (taken.has(`n${k}`)) k++; taken.add(`n${k}`); return `n${k}`; };
  const used = new Set();
  const match = (value) => said.find((s) => !used.has(s) && close(s.amount, Number(value)));
  const cues = {}, refs = [], times = [];
  if (sc.type === "line-chart") {
    // The first line's points, drawn up to each one as its number is said.
    const pts = sc.props.series?.[0]?.points ?? [];
    if (sc.props.pointCues?.some(Boolean) || pts.length < 2) return null;
    const pc = pts.map((pt) => {
      const s = match(Array.isArray(pt) ? pt[1] : pt?.y);
      if (!s) return null;
      used.add(s);
      const n = name();
      cues[n] = s.phrase;
      times.push(s.t);
      return n;
    });
    if (pc.some(Boolean)) refs.push({ path: ["props", "pointCues"], value: pc });
  } else {
    for (const el of elements(sc.type, sc.props)) {
      if (el.cue) continue;
      const s = match(el.value);
      if (!s) continue;
      used.add(s);
      const n = name();
      cues[n] = s.phrase;
      times.push(s.t);
      refs.push({ path: el.path, value: el.row ? { label: "合计", cue: n } : n });
    }
  }
  return refs.length ? { cues, refs, times } : null;
}
