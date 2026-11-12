// Candidates for every scene before the storyboard is drawn: stock-search queries per scene (the
// script's own `search`, else a chat model reading narration, visual intent and the facts it
// cites), searched in the licensed archives, ranked, and turned into manifest items on request.
import { DEFAULT_PROVIDER_ORDER, DEFAULT_VIDEO_PROVIDERS, nasaFullUrl, scoreCandidate, search } from "./sources.mjs";
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

// scene id → queries. Scenes with `search` keep theirs; the rest go to the model in one call.
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
  if (askFn) {
    try { data = (await askFn({ prompt: suggestAssetsPrompt({ title, scenes: open, per }), json: true, maxTokens: 1500 })).data ?? {}; }
    catch (e) { data = { _error: e.message }; }
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
export async function sceneCandidates(queries, { kind = "image", providers, aspect = 16 / 9, per = 3, skip = new Set(), searchFn = search, wait = sleep, onWarn = () => {} }) {
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
  const rest = found.filter((c) => !firsts.includes(c)).sort((a, b) => a.score - b.score);
  return [...firsts, ...rest].slice(0, per);
}

// Manifest items for picked candidates: a direct url with license, author and source recorded,
// so assets fetch downloads exactly what was shown. Ids are <scene>-<n>, unused in the manifest.
export async function candidateItems(sceneId, candidates, { taken = new Set(), fullUrl = nasaFullUrl } = {}) {
  const items = [];
  let n = 1;
  for (const c of candidates) {
    while (taken.has(`${sceneId}-${n}`)) n++;
    const id = `${sceneId}-${n}`;
    taken.add(id);
    const url = c.provider === "nasa" ? await fullUrl(c.pid, c.kind) : c.url;
    if (!url) continue;
    items.push({ id, kind: c.kind, url, license: c.license, author: c.author || c.provider, title: c.title, source: c.source, ...(c.width ? { width: c.width, height: c.height } : {}), note: `suggest: ${sceneId} · "${c.query}" · ${c.provider}` });
  }
  return items;
}
