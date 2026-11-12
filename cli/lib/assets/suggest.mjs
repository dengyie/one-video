// Candidates for every scene before the storyboard is drawn: stock-search queries per scene (the
// script's own `search`, else a chat model reading narration, visual intent and the facts it
// cites), searched in the licensed archives (footage first, then photos), ranked, and turned into
// manifest items on request; a scene nothing licensed fits gets an AI still to stand in.
import { DEFAULT_PROVIDER_ORDER, DEFAULT_VIDEO_PROVIDERS, fullUrl as resolveUrl, scoreCandidate, search } from "./sources.mjs";
import { suggestAssetsPrompt } from "../prompts/index.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What a scene is about, in one line: narration (or its lines), the visual intent, the cited facts.
export function sceneBrief(scene, research) {
  const facts = new Map((research?.facts ?? []).map((f) => [f.id, f.claim]));
  const said = Array.isArray(scene.lines) ? scene.lines.map((l) => (typeof l === "string" ? l : l.text)).join("") : scene.narration ?? "";
  return [said, scene.visualIntent && `visual: ${scene.visualIntent}`, ...(scene.claims ?? []).map((c) => facts.get(c)).filter(Boolean).map((c) => `fact: ${c}`)].filter(Boolean).join(" · ");
}

// Latin-script names in a brief ("NVIDIA", "Jensen Huang", "H100"): the fallback query without a model.
export function latinTerms(text, max = 3) {
  const seen = new Set();
  for (const m of String(text).matchAll(/[A-Za-z][A-Za-z0-9.&'-]*(?:\s+[A-Z][A-Za-z0-9.&'-]*)*/g)) {
    const t = m[0].trim();
    if (t.length > 1 && !/^(visual|fact)$/i.test(t)) seen.add(t);
  }
  return [...seen].slice(0, max);
}

// scene id → queries. Scenes with `search` keep theirs; the rest go to the model in one call, with
// room for every scene (a reply cut short parses as a partial object), and the scenes a reply left
// out are asked once more on their own before falling back to the names in the script.
export async function sceneQueries(scenes, { research, title, per = 3, askFn }) {
  const out = {};
  const open = [];
  for (const s of scenes) {
    if (s.beat === "credits") continue;
    if (s.search?.length) out[s.id] = s.search;
    else open.push({ id: s.id, text: sceneBrief(s, research) });
  }
  if (!open.length) return out;
  let data = {};
  const askFor = async (list) => {
    try { Object.assign(data, (await askFn({ prompt: suggestAssetsPrompt({ title, scenes: list, per }), json: true, maxTokens: Math.max(3000, 400 * list.length) })).data ?? {}); }
    catch (e) { data._error = e.message; }
  };
  if (askFn) {
    await askFor(open);
    const missing = open.filter((s) => !Array.isArray(data[s.id]) || !data[s.id].length);
    if (missing.length && missing.length < open.length) await askFor(missing);
  }
  for (const s of open) {
    const q = Array.isArray(data[s.id]) ? data[s.id].filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : [];
    out[s.id] = q.length ? q.slice(0, per) : latinTerms(s.text, per);
  }
  if (data._error) out._error = data._error;
  return out;
}

// Ranked candidates for one scene across its queries, one per source, skipping media already in
// the manifest. A rate-limited archive (Wikimedia answers 429 to bursts) is tried once more.
// kind "both": footage and photos; the best clip, when there is one, is always among the picks.
export async function sceneCandidates(queries, { kind = "both", providers, aspect = 16 / 9, per = 3, skip = new Set(), searchFn = search, wait = sleep, onWarn = () => {} }) {
  const kinds = kind === "both" ? ["video", "image"] : [kind];
  const found = [];
  const seen = new Set(skip);
  for (const k of kinds) for (const query of queries) {
    const list = providers ?? (k === "video" ? DEFAULT_VIDEO_PROVIDERS() : DEFAULT_PROVIDER_ORDER);
    let res = await searchFn(query, { providers: list, kind: k, limit: 8 });
    const limited = res.errors.filter((e) => /\b429\b|rate.?limit|too many/i.test(e));
    if (limited.length) {
      await wait(20000);
      const again = await searchFn(query, { providers: limited.map((e) => e.split(":")[0]), kind: k, limit: 8 });
      res = { results: [...res.results, ...again.results], errors: [...res.errors.filter((e) => !limited.includes(e)), ...again.errors] };
    }
    for (const e of res.errors) onWarn(`"${query}": ${e}`);
    for (const c of res.results.filter((c) => c.kind === k).sort((a, b) => scoreCandidate(a, aspect) - scoreCandidate(b, aspect))) {
      if (!c.source || seen.has(c.source)) continue;
      seen.add(c.source);
      found.push({ ...c, query, score: Number(scoreCandidate(c, aspect).toFixed(2)) });
    }
  }
  // Best first, but every query keeps its best hit in the top `per`.
  const firsts = queries.map((q) => found.find((c) => c.query === q)).filter(Boolean);
  const clip = found.find((c) => c.kind === "video");
  if (clip && !firsts.includes(clip)) firsts.splice(Math.max(0, Math.min(firsts.length, per - 1)), 0, clip);
  const rest = found.filter((c) => !firsts.includes(c)).sort((a, b) => a.score - b.score);
  return [...firsts, ...rest].slice(0, per);
}

// Manifest items for picked candidates: a direct url with license, author and source recorded,
// so assets fetch downloads exactly what was shown. Ids are <scene>-<n>, unused in the manifest.
export async function candidateItems(sceneId, candidates, { taken = new Set(), fullUrl = resolveUrl } = {}) {
  const items = [];
  let n = 1;
  for (const c of candidates) {
    while (taken.has(`${sceneId}-${n}`)) n++;
    const id = `${sceneId}-${n}`;
    taken.add(id);
    const url = c.url ?? (await fullUrl(c));
    if (!url) continue;
    items.push({ id, kind: c.kind, url, license: c.license, author: c.author || c.provider, title: c.title, source: c.source, ...(c.width ? { width: c.width, height: c.height } : {}), note: `suggest: ${sceneId} · "${c.query}" · ${c.provider}` });
  }
  return items;
}

// A scene nothing licensed fits: an AI still from what it should show (licensed "generated", which
// the density gate does not count as a real asset), with the first query as a stock fallback.
export function generatedItem(scene, queries, { taken = new Set() } = {}) {
  let n = 1;
  while (taken.has(`${scene.id}-${n}`)) n++;
  const id = `${scene.id}-${n}`;
  taken.add(id);
  const what = scene.visualIntent || queries.join(", ");
  if (!what) return null;
  return { id, kind: "image", generate: { prompt: `${what}，电影感，写实，无文字`, brief: `stands in for scene ${scene.id}: nothing licensed found` }, ...(queries[0] ? { query: queries[0] } : {}), note: `suggest: ${scene.id} · AI still (no licensed match)` };
}
