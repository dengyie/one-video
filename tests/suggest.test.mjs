import { test } from "node:test";
import assert from "node:assert/strict";
import { candidateItems, latinTerms, sceneBrief, sceneCandidates, sceneQueries } from "../cli/lib/assets/suggest.mjs";
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
  const askFn = async (o) => { prompt = o.prompt; return { data: { b: ["NVIDIA H100 GPU", "data center racks"], c: [] } }; };
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
  const c = await sceneCandidates(["q1", "q2"], { searchFn, wait: async (ms) => { waited += ms; }, skip: new Set(["s-known"]), per: 3, providers: ["nasa", "wikimedia"] });
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
  const items = await candidateItems("hook", cands, { taken: new Set(["hook-1"]), fullUrl: async (pid) => `https://nasa/${pid}~orig.jpg` });
  assert.deepEqual(items.map((x) => x.id), ["hook-2", "hook-3"]);
  assert.equal(items[0].url, "https://w/x.jpg");
  assert.equal(items[0].license, "CC BY 4.0");
  assert.equal(items[1].url, "https://nasa/n1~orig.jpg");
  assert.match(items[0].note, /suggest: hook · "q" · wikimedia/);
});
