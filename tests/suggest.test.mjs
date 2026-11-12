import { test } from "node:test";
import assert from "node:assert/strict";
import { candidateItems, generatedItem, latinTerms, sceneBrief, sceneCandidates, sceneQueries } from "../cli/lib/assets/suggest.mjs";
import { archiveFullUrl, licenseFromUrl, scoreCandidate } from "../cli/lib/assets/sources.mjs";
import { suggestAssetsPrompt } from "../cli/lib/prompts/index.mjs";

const research = { facts: [{ id: "f1", claim: "NVIDIA H100 shipments doubled" }] };

test("sceneBrief joins what is said, the visual intent and the cited facts; latinTerms pulls names", () => {
  const brief = sceneBrief({ id: "a", narration: "黄仁勋站在 GTC 台上。", visualIntent: "Jensen Huang keynote", claims: ["f1"] }, research);
  assert.match(brief, /GTC/);
  assert.match(brief, /visual: Jensen Huang keynote/);
  assert.match(brief, /fact: NVIDIA H100/);
  assert.deepEqual(latinTerms("黄仁勋 GTC · visual: Jensen Huang keynote"), ["GTC", "Jensen Huang", "keynote"]);
});

test("sceneQueries: the script's own search wins, the model fills the rest, names when it fails", async () => {
  const scenes = [{ id: "a", search: ["Santa Clara campus"] }, { id: "b", narration: "NVIDIA 的 H100" }, { id: "c", narration: "OpenAI 的订单" }, { id: "z", beat: "credits" }];
  let prompt = "";
  const askFn = async (o) => { prompt ||= o.prompt; return { data: { b: ["NVIDIA H100 GPU", "data center racks"], c: [] } }; };
  const q = await sceneQueries(scenes, { research, per: 2, askFn });
  assert.deepEqual(q.a, ["Santa Clara campus"]);
  assert.deepEqual(q.b, ["NVIDIA H100 GPU", "data center racks"]);
  assert.deepEqual(q.c, ["OpenAI"]);
  assert.equal(q.z, undefined);
  assert.match(prompt, /\[b\] NVIDIA 的 H100/);
  assert.ok(!/\[a\]/.test(prompt));
  const failed = await sceneQueries([{ id: "b", narration: "NVIDIA 的 H100" }], { askFn: async () => { throw new Error("down"); } });
  assert.deepEqual(failed.b, ["NVIDIA", "H100"]);
  assert.equal(failed._error, "down");
  assert.match(suggestAssetsPrompt({ scenes: [{ id: "x", text: "t" }], per: 3 }), /3 short English search queries/);
});

test("sceneCandidates ranks across queries, dedupes sources, skips known media and retries a rate-limited archive", async () => {
  const hit = (provider, source, license, w = 1920, h = 1080) => ({ provider, kind: "image", source, license, width: w, height: h, url: `${source}.jpg` });
  const calls = [];
  const searchFn = async (query, { providers }) => {
    calls.push([query, providers.join()]);
    if (query === "q1" && providers.includes("nasa")) return { results: [hit("nasa", "s-small", "PD (NASA)", 400, 300), hit("nasa", "s-known", "PD (NASA)")], errors: ["wikimedia: HTTP 429 Too Many Requests"] };
    if (query === "q1") return { results: [hit("wikimedia", "s-wiki", "CC BY 4.0")], errors: [] };
    return { results: [hit("openverse", "s-wiki", "CC BY 4.0"), hit("openverse", "s-cc0", "CC0")], errors: [] };
  };
  let waited = 0;
  const c = await sceneCandidates(["q1", "q2"], { kind: "image", searchFn, wait: async (ms) => { waited += ms; }, skip: new Set(["s-known"]), per: 3, providers: ["nasa", "wikimedia"] });
  assert.equal(waited, 20000);
  assert.deepEqual(calls.map((x) => x[0]), ["q1", "q1", "q2"]);
  assert.equal(calls[1][1], "wikimedia");
  // Each query's best hit first, then the rest by score; s-wiki only once, s-known skipped.
  assert.deepEqual(c.map((x) => x.source), ["s-wiki", "s-cc0", "s-small"]);
  assert.equal(c[1].query, "q2");
});

test("candidateItems: free ids per scene, a direct url with license, author and source", async () => {
  const cands = [
    { provider: "wikimedia", kind: "image", url: "https://w/x.jpg", license: "CC BY 4.0", author: "A", title: "X", source: "https://w/File:X", width: 3000, height: 2000, query: "q" },
    { provider: "nasa", pid: "n1", kind: "image", license: "PD (NASA)", author: "NASA", source: "https://images.nasa.gov/details/n1", query: "q" },
  ];
  const items = await candidateItems("hook", cands, { taken: new Set(["hook-1"]), fullUrl: async (c) => `https://nasa/${c.pid}~orig.jpg` });
  assert.deepEqual(items.map((x) => x.id), ["hook-2", "hook-3"]);
  assert.equal(items[0].url, "https://w/x.jpg");
  assert.equal(items[0].license, "CC BY 4.0");
  assert.equal(items[1].url, "https://nasa/n1~orig.jpg");
  assert.match(items[0].note, /suggest: hook · "q" · wikimedia/);
});

test("kind both: the best clip is always among the picks, even when photos score better", async () => {
  const searchFn = async (query, { kind }) => ({ errors: [], results: kind === "video"
    ? [{ provider: "archive", kind: "video", source: `v-${query}`, license: "CC BY 4.0", width: 640, height: 480 }]
    : [1, 2, 3].map((i) => ({ provider: "wikimedia", kind: "image", source: `i-${query}-${i}`, license: "CC0", width: 1920, height: 1080 })) });
  const c = await sceneCandidates(["q1", "q2"], { searchFn, per: 2 });
  assert.equal(c.length, 2);
  assert.ok(c.some((x) => x.kind === "video"));
  const photos = await sceneCandidates(["q1"], { kind: "image", searchFn, per: 2 });
  assert.ok(photos.every((x) => x.kind === "image"));
});

test("Internet Archive: open licences only, the sharpest file that fits", async () => {
  assert.equal(licenseFromUrl("http://creativecommons.org/licenses/publicdomain/"), "PD");
  assert.equal(licenseFromUrl("https://creativecommons.org/publicdomain/zero/1.0/"), "CC0");
  assert.equal(licenseFromUrl("https://creativecommons.org/licenses/by-sa/4.0/"), "CC BY-SA 4.0");
  assert.equal(licenseFromUrl("https://creativecommons.org/licenses/by-nc-nd/4.0/"), "unknown");
  const files = [
    { name: "film.mpeg", size: "9000000", height: "1080" },
    { name: "film_512kb.mp4", size: "6000000", width: "320", height: "240" },
    { name: "film.mp4", size: "20000000", width: "854", height: "480" },
    { name: "film.webm", size: "30000000", width: "1920", height: "1080" },
    { name: "film 4k.mp4", size: "900000000", width: "3840", height: "2160" },
  ];
  assert.deepEqual(await archiveFullUrl("x y", { fetchJson: async () => ({ files }) }), { url: "https://archive.org/download/x%20y/film.mp4", width: 854, height: 480 });
  assert.equal(await archiveFullUrl("x", { fetchJson: async () => ({ files: [files[0]] }) }), null);
  // Only a 320x240 mp4 derivative: the sharper ogv or avi original wins (an .mpeg one cannot be read).
  const old = [{ name: "reel.mpeg", size: "186000000", height: "480" }, { name: "reel.ogv", size: "29000000", height: "304" }, { name: "reel_512kb.mp4", size: "30000000", height: "240" }];
  assert.equal((await archiveFullUrl("r", { fetchJson: async () => ({ files: old }) })).url, "https://archive.org/download/r/reel.ogv");
  old.push({ name: "reel.avi", size: "90000000", height: "480" });
  assert.equal((await archiveFullUrl("r", { fetchJson: async () => ({ files: old }) })).url, "https://archive.org/download/r/reel.avi");
});

test("generatedItem: an AI still from the visual intent, the first query kept as stock fallback", () => {
  const taken = new Set(["hook-1"]);
  const g = generatedItem({ id: "hook", visualIntent: "GPU 机房走廊" }, ["data center"], { taken });
  assert.equal(g.id, "hook-2");
  assert.match(g.generate.prompt, /^GPU 机房走廊，/);
  assert.equal(g.query, "data center");
  assert.ok(taken.has("hook-2"));
  assert.equal(generatedItem({ id: "z" }, [], {}), null);
});

test("sceneQueries asks again for the scenes a cut-short reply left out", async () => {
  const scenes = ["a", "b", "c"].map((id) => ({ id, narration: `场景 ${id}` }));
  const asked = [];
  const askFn = async (o) => {
    const ids = [...o.prompt.matchAll(/\[(\w)\]/g)].map((m) => m[1]);
    asked.push([ids.join(""), o.maxTokens]);
    return { data: asked.length === 1 ? { a: ["qa"], truncated: true } : Object.fromEntries(ids.map((id) => [id, [`q${id}`]])) };
  };
  const q = await sceneQueries(scenes, { askFn });
  assert.deepEqual([q.a, q.b, q.c], [["qa"], ["qb"], ["qc"]]);
  assert.deepEqual(asked, [["abc", 3000], ["bc", 3000]]);
});

test("scoreCandidate: the archive's best match, sharp and short footage come first", () => {
  const base = { kind: "video", license: "PD", width: 1920, height: 1080 };
  assert.ok(scoreCandidate({ ...base, rank: 0 }) < scoreCandidate({ ...base, rank: 4 }));
  assert.ok(scoreCandidate({ ...base, width: 1280, height: 720 }) < scoreCandidate({ ...base, width: 312, height: 176 }));
  assert.ok(scoreCandidate({ ...base, duration: 60 }) < scoreCandidate({ ...base, duration: 3715 }));
});
