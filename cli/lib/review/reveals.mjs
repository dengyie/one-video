// Chart elements the narration says by number or date: a cue to pin each one's reveal on the words that say it.
// Reads a compiled timeline scene (props with cue names, caption lines); the cues it proposes go
// into the storyboard as phrases.
import { normalizeForMatch, parseNumber } from "../core/text.mjs";
import { CUE_LEAD, phraseTime } from "../timeline/cues.mjs";
import { racePeriods } from "../timeline/events.mjs";

// Same tokens as extractNumbers; dates and counts of years are not values a chart shows.
const NUMBER = /\d+(?:[.,]\d+)*(?:万亿|亿|万|千|百|%|倍|年|月|日|美元|元)?/g;
const DATE = new Set(["年", "月", "日"]);
const TOLERANCE = 0.02;
// A spoken date: a 4-digit year, a month, a day, any run of them ("1990年", "11月5日", "2024年12月").
const SPOKEN_DATE = /(?<!\d)(?:(\d{4})年)?(?:(\d{1,2})月)?(?:(\d{1,2})[日号])?/g;

// What a chart reveals one by one: each element's value, its cue (if any) and where a cue goes.
function elements(type, p = {}) {
  const list = (arr, key, field = "value") => (Array.isArray(arr) ? arr : []).map((x, i) => ({ value: x?.[field], cue: x?.cue, path: ["props", key, i, "cue"] }));
  switch (type) {
    case "stat-cards": return list(p.cards, "cards");
    case "bar-compare":
    case "scale-compare": return list(p.items, "items");
    case "unit-grid": return list(p.groups, "groups", "count");
    case "compare": return ["left", "right"].filter((k) => p[k]).map((k) => ({ value: p[k].value, cue: p[k].cue, path: ["props", k, "cue"] }));
    case "timeline": return (Array.isArray(p.events) ? p.events : []).map((e, i) => ({ date: e?.date, cue: e?.cue, path: ["props", "events", i, "cue"] }));
    case "share": {
      // A spoken total is the ring's sum; with no total row yet, one is added for it.
      const sum = (p.segments ?? []).reduce((s, x) => s + (Number(x?.value) || 0), 0);
      return [...list(p.segments, "segments"), p.total ? { value: sum, cue: p.total.cue, path: ["props", "total", "cue"] } : { value: sum, path: ["props", "total"], row: true }];
    }
    default: return [];
  }
}

// An element's date label: "1990", "2024.12", "2024-12-03", "11.05" (trailing words like " 晚" ignored).
function labelDate(label) {
  const m = String(label ?? "").trim().match(/^(\d{1,4})(?:[.\-/](\d{1,2}))?(?:[.\-/](\d{1,2}))?/);
  if (!m) return null;
  const [a, b, c] = m.slice(1).map((x) => (x === undefined ? undefined : Number(x)));
  if (m[1].length === 4) return { y: a, m: b, d: c };
  return b === undefined || c !== undefined ? null : { m: a, d: b };
}
// Every part the label has is said, and said the same ("2024.12" in "2024年12月3日", not in "12月").
const sameDate = (label, said) => {
  const d = labelDate(label);
  return !!d && ["y", "m", "d"].every((k) => d[k] === undefined || d[k] === said[k]);
};

const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b !== 0 && Math.abs(Math.abs(a) - Math.abs(b)) <= TOLERANCE * Math.abs(b);

// The shortest phrase ending at idx+len that finds this occurrence in hay (a cue phrase resolves
// to its first match), or null.
function phraseAt(hay, idx, len) {
  for (let k = 0; k <= 4 && k <= idx; k++) {
    const p = hay.slice(idx - k, idx + len);
    if (hay.indexOf(p) === idx - k) return p;
  }
  return null;
}

// Where the narration says a short on-screen text (a card's note, a compare item): the line that
// holds most of its characters (3/4 or more, "史上最大 IPO" in "是史上规模最大的IPO"), and in it the
// first run (2–6 characters) the text also has in a row. { phrase, t } or null.
function saidText(sc, text) {
  const lines = sc.lines ?? [];
  const want = normalizeForMatch(String(text ?? ""));
  if (want.length < 4) return null;
  const norm = lines.map((l) => normalizeForMatch(String(l.text ?? "")));
  let best = null;
  norm.forEach((n, li) => {
    const pool = [...n];
    let hit = 0;
    for (const c of want) {
      const j = pool.indexOf(c);
      if (j >= 0) { hit++; pool.splice(j, 1); }
    }
    if (hit >= 0.75 * want.length && (!best || hit > best.hit)) best = { li, hit };
  });
  if (!best) return null;
  const n = norm[best.li];
  let k = 0;
  while (k < n.length - 1 && !want.includes(n.slice(k, k + 2))) k++;
  if (k >= n.length - 1) return null;
  let len = 2;
  while (len < 6 && k + len < n.length && want.includes(n.slice(k, k + len + 1))) len++;
  const hay = norm.join("");
  const phrase = phraseAt(hay, norm.slice(0, best.li).join("").length + k, len);
  const t = phrase && phraseTime(lines, phrase);
  return Number.isFinite(t) ? { phrase, t: Math.max(0, t - CUE_LEAD) } : null;
}

// Numbers spoken in the scene, in order: amount, the shortest phrase that finds this occurrence
// (a cue phrase resolves to its first match), and the scene time the cue would fire.
// Dates are found in each line's own text: normalizing drops the commas that keep "1990年，11月" apart.
function spoken(sc) {
  const lines = sc.lines ?? [];
  const norm = lines.map((l) => normalizeForMatch(String(l.text ?? "")));
  const hay = norm.join("");
  const out = [];
  const add = (idx, len, what) => {
    const phrase = phraseAt(hay, idx, len);
    const t = phrase && phraseTime(lines, phrase);
    if (Number.isFinite(t)) out.push({ ...what, idx, phrase, t: Math.max(0, t - CUE_LEAD) });
  };
  for (const m of hay.matchAll(NUMBER)) {
    const n = parseNumber(m[0]);
    if (n && !DATE.has(n.unit)) add(m.index, m[0].length, { amount: n.amount });
  }
  let at = 0;
  lines.forEach((l, li) => {
    const text = String(l.text ?? "");
    for (const m of text.matchAll(SPOKEN_DATE)) {
      if (!m[0]) continue;
      const [y, mo, d] = m.slice(1).map((x) => (x === undefined ? undefined : Number(x)));
      add(at + normalizeForMatch(text.slice(0, m.index)).length, m[0].length, { date: { y, m: mo, d } });
    }
    at += norm[li].length;
  });
  return out.sort((a, b) => a.idx - b.idx);
}

// { cues: {name: phrase}, refs: [{path, value}], times: [scene seconds], texts: [cue names said
// as words, not numbers or dates] } for the elements of `sc` with no cue whose value, date or
// words the narration says, or null when there is none.
export function numberReveals(sc) {
  if (!sc?.props) return null;
  const said = spoken(sc);
  const taken = new Set(Object.keys(sc.cues ?? {}));
  const name = () => { let k = 1; while (taken.has(`n${k}`)) k++; taken.add(`n${k}`); return `n${k}`; };
  const used = new Set();
  const match = (value) => said.find((s) => !used.has(s) && s.amount !== undefined && close(s.amount, Number(value)));
  const matchDate = (label) => said.find((s) => !used.has(s) && s.date && sameDate(label, s.date));
  const cues = {}, refs = [], times = [], texts = [];
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
  } else if (sc.type === "bar-race") {
    // Periods with no cue get one where their year is said; the cued ones keep theirs.
    const old = sc.props.periodCues ?? [];
    const pc = (sc.props.periods ?? []).map((label, k) => {
      if (old[k]) return old[k];
      const s = matchDate(label);
      if (!s) return null;
      used.add(s);
      const n = name();
      cues[n] = s.phrase;
      times.push(s.t);
      return n;
    });
    if (pc.some((c, k) => c && !old[k])) refs.push({ path: ["props", "periodCues"], value: pc });
    // A bar whose value is said gets called out on those words, while the race shows that value's
    // period (each period counted from half a second before the swap into it); a bar
    // whose name is said, while it is in the top ranks then. A value said just before its period
    // arrives (by the end of that line) calls the bar out on that period's cue instead.
    const T = racePeriods(sc);
    const series = sc.props.series ?? [];
    const top = sc.props.top ?? 10;
    const shown = (t) => T.findIndex((_, k) => (k ? T[k] - 0.5 : 0) <= t && (k === T.length - 1 || t < T[k + 1] - 0.5));
    const ranked = (i, k) => Number.isFinite(series[i]?.values?.[k]) && series.filter((o) => (o?.values?.[k] ?? -Infinity) > series[i].values[k]).length < top;
    const call = (i, s) => {
      const n = name();
      cues[n] = s.phrase;
      times.push(s.t);
      if (s.amount === undefined) texts.push(n);
      refs.push({ path: ["props", "series", i, "cue"], value: n });
    };
    const lines = sc.lines ?? [];
    const lineEnd = (t) => lines.findLast((l) => l.start <= t + CUE_LEAD)?.end ?? -Infinity;
    const byValue = series.map((se, i) => {
      if (se?.cue) return true;
      const said$ = said.filter((x) => !used.has(x) && x.amount !== undefined);
      const s = said$.find((x) => (se?.values ?? []).some((v, k) => close(x.amount, Number(v)) && shown(x.t) === k));
      if (s) { used.add(s); call(i, s); return true; }
      const k = (se?.values ?? []).findIndex((v, k) => k > 0 && pc[k] && said$.some((x) => close(x.amount, Number(v)) && shown(x.t) === k - 1 && T[k] <= lineEnd(x.t) + 0.5));
      if (k > 0) refs.push({ path: ["props", "series", i, "cue"], value: pc[k] });
      return k > 0;
    });
    series.forEach((se, i) => {
      const phrase = normalizeForMatch(String(se?.name ?? ""));
      const at = !byValue[i] && phrase.length >= 2 && phraseTime(lines, phrase);
      if (!Number.isFinite(at)) return;
      const t = Math.max(0, at - CUE_LEAD);
      if (ranked(i, shown(t))) call(i, { phrase, t });
    });
  } else {
    for (const el of elements(sc.type, sc.props)) {
      if (el.cue) continue;
      const s = el.date !== undefined ? matchDate(el.date) : match(el.value);
      if (!s) continue;
      used.add(s);
      const n = name();
      cues[n] = s.phrase;
      times.push(s.t);
      refs.push({ path: el.path, value: el.row ? { label: "合计", cue: n } : n });
    }
  }
  // A note or compare item shows with its card; one whose words are said a second or more later
  // comes in on them.
  const own = (text, after) => {
    const s = saidText(sc, text);
    if (!s || s.t < after + 1) return null;
    const n = name();
    cues[n] = s.phrase;
    times.push(s.t);
    texts.push(n);
    return n;
  };
  if (sc.type === "stat-cards") (sc.props.cards ?? []).forEach((c, i) => {
    const n = c?.note && !c.noteCue && own(c.note, sc.cues?.[c.cue] ?? 0);
    if (n) refs.push({ path: ["props", "cards", i, "noteCue"], value: n });
  });
  if (sc.type === "compare") for (const k of ["left", "right"]) {
    const side = sc.props[k];
    if (!side?.items?.length || side.itemCues?.some(Boolean)) continue;
    const ic = side.items.map((it) => own(it, sc.cues?.[side.cue] ?? 0));
    if (ic.some(Boolean)) refs.push({ path: ["props", k, "itemCues"], value: ic });
  }
  return refs.length ? { cues, refs, times, texts } : null;
}
