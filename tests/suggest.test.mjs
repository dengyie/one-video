import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { candidateItems, generatedItem, latinTerms, sceneBrief, sceneCandidates, sceneQueries } from "../cli/lib/assets/suggest.mjs";
import { PROVIDERS, archiveFullUrl, licenseFromUrl, scoreCandidate } from "../cli/lib/assets/sources.mjs";
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
  const askFn = async (o) => { prompt ||= o.prompt; return { data: { b: { queries: ["NVIDIA H100 GPU", "data center racks"], still: "rows of GPU servers in a dim hall" }, c: [] } }; };
  const q = await sceneQueries(scenes, { research, per: 2, askFn });
  assert.deepEqual(q.a, ["Santa Clara campus"]);
  assert.deepEqual(q.b, ["NVIDIA H100 GPU", "data center racks"]);
  assert.deepEqual(q.c, ["OpenAI"]);
  assert.equal(q.z, undefined);
  assert.deepEqual(q._stills, { b: "rows of GPU servers in a dim hall" });
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

test("Internet Archive search: the whole phrase, footage collections first, each film once", async () => {
  const urls = [];
  const doc = (identifier, licenseurl = "http://creativecommons.org/licenses/publicdomain/") => ({ identifier, title: identifier, licenseurl });
  const getJsonFn = async (u) => {
    urls.push(decodeURIComponent(u));
    return { response: { docs: /collection:/.test(decodeURIComponent(u)) ? [doc("machine-master-or-slave"), doc("no-licence", null)] : [doc("wall-street-mystery"), doc("machine-master-or-slave")] } };
  };
  const hits = await PROVIDERS.archive('factory "workers', { kind: "video", getJsonFn });
  assert.deepEqual(hits.map((h) => h.pid), ["machine-master-or-slave", "wall-street-mystery"]);
  assert.match(urls[0], /title:\("factory  workers"\) OR subject:.*collection:\(prelinger OR universal_newsreels OR fedflix\)/);
  assert.match(urls[1], /q=title:\("factory  workers"\) AND mediatype:movies AND \(licenseurl/);
  assert.deepEqual(await PROVIDERS.archive("x", { kind: "image", getJsonFn }), []);
});

test("generatedItem: an AI still from the visual intent, the first query kept as stock fallback", () => {
  const taken = new Set(["hook-1"]);
  const g = generatedItem({ id: "hook", visualIntent: "GPU 机房走廊" }, ["data center"], { taken });
  assert.equal(g.id, "hook-2");
  assert.match(g.generate.prompt, /^GPU 机房走廊\. Cinematic/);
  assert.match(g.generate.prompt, /No real or recognizable person.*No company or brand logos/);
  assert.equal(g.query, "data center");
  assert.ok(taken.has("hook-2"));
  // The model's still wins over the visual intent; the queries alone (they name people) never make one.
  assert.match(generatedItem({ id: "hook", visualIntent: "x" }, [], { taken, still: "an empty keynote stage" }).generate.prompt, /^an empty keynote stage\./);
  assert.equal(generatedItem({ id: "z" }, ["Jensen Huang Donald Trump"], {}), null);
  assert.match(generatedItem({ id: "hook" }, ["gpu"], { taken, alone: false, still: "s" }).note, /AI still$/);
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

test("pickClipWindow: a long film is cut around the frame a vision model picks, not at its title card", async () => {
  const { pickClipWindow, sampleTimes, windowAround } = await import("../cli/lib/assets/media.mjs");
  assert.deepEqual(sampleTimes(160, 4), [20, 60, 100, 140]);
  assert.equal(windowAround(5, 160), 0);
  assert.equal(windowAround(155, 160), 140);
  const { mkdtempSync: mk, writeFileSync: wf } = await import("node:fs");
  const { tmpdir: td } = await import("node:os");
  const grab = async (_src, t, out) => { wf(out, Buffer.from([0xff, 0xd8, t])); return out; };
  let seen;
  const askFn = async (o) => { seen = o; return { data: { best: 5, reason: "street crowd" }, model: "m" }; };
  const w = await pickClipWindow(join(mk(join(td(), "ov-")), "x.ogv"), { brief: "stock market crowd", probe: async () => ({ format: { duration: "172.3" } }), grab, askFn });
  assert.equal(seen.images.length, 8);
  assert.match(seen.prompt, /Never a title card/);
  assert.match(seen.prompt, /stock market crowd/);
  assert.deepEqual(w, { clip: [windowAround(sampleTimes(172.3)[5], 172.3), 20], pick: { model: "m", at: sampleTimes(172.3)[5], reason: "street crowd" } });
  // A model that fails: skip the opening fifth. A short source is cut from its start.
  const warns = [];
  const f = await pickClipWindow("x", { probe: async () => ({ format: { duration: "200" } }), grab, askFn: async () => { throw new Error("down"); }, onWarn: (m) => warns.push(m) });
  assert.deepEqual(f, { clip: [40, 20], pick: null });
  assert.match(warns[0], /skipping the opening fifth/);
  const off = await pickClipWindow("x", { brief: "trading floor", probe: async () => ({ format: { duration: "200" } }), grab, askFn: async () => ({ data: { best: -1, reason: "a talk show" }, model: "m" }), onWarn: (m) => warns.push(m) });
  assert.deepEqual(off, { clip: [40, 20], pick: { model: "m", at: null, reason: "a talk show", fits: false } });
  assert.match(warns[1], /no frame of this film shows "trading floor".*try the next pick/);
  assert.equal(await pickClipWindow("x", { probe: async () => ({ format: { duration: "35" } }), grab, askFn }), null);
});
