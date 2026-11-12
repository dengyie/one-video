// Text-to-image through the relay's /images/generations, with optional takes picked by a vision model.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { download, request, requireApiKey } from "../core/http.mjs";
import { ask } from "../llm/client.mjs";
import { pickTakePrompt } from "../prompts/index.mjs";
import { IMAGE_DEFAULTS, IMAGE_SIZE, firstModel, genConfig, imageExt, jpegPart } from "./common.mjs";

async function imageTake(cfg, key, model) {
  // OpenAI image models always answer in base64; others (grok) are asked to, since their URLs can
  // point at the relay's loopback.
  const json = { model, prompt: cfg.prompt, size: cfg.size, n: 1, ...(/^gpt-image|^dall-e/.test(model) ? {} : { response_format: "b64_json" }) };
  const res = await request(`${cfg.baseUrl.replace(/\/$/, "")}/images/generations`, { method: "POST", key, json, timeoutSec: 300, retries: 1 });
  const d = JSON.parse(res.body.toString()).data?.[0];
  if (d?.b64_json) return { buf: Buffer.from(d.b64_json, "base64") };
  if (d?.url) return { buf: await download(d.url) };
  throw new Error(`no image in reply: ${res.body.subarray(0, 200).toString()}`);
}

// `variants: N` makes N takes and lets a vision model pick the one that fits the brief (`pick`
// overrides with an index); every take stays on disk as <id>.take<k>.<ext> for the director.
export async function generateImage(item, { dir, defaults = {}, aspect = "16:9", llm = {}, onWarn = () => {} }) {
  const cfg = genConfig(item, { ...IMAGE_DEFAULTS, size: IMAGE_SIZE[aspect] ?? IMAGE_SIZE["16:9"] }, defaults);
  const key = requireApiKey(cfg.keyEnv, cfg.baseUrl);
  const n = Math.max(1, Math.min(4, cfg.variants ?? 1));
  const takes = [];
  for (let k = 0; k < n; k++) {
    try {
      const t = await firstModel(cfg, `image "${item.id}"`, (model) => imageTake(cfg, key, model));
      const file = n > 1 ? `assets/${item.id}.take${k}.${imageExt(t.buf)}` : `assets/${item.id}.${imageExt(t.buf)}`;
      writeFileSync(join(dir, file.slice("assets/".length)), t.buf);
      takes.push({ ...t, file, k });
    } catch (e) {
      if (k === n - 1 && !takes.length) throw e;
      onWarn(`${item.id} take ${k}: ${e.message}`);
    }
  }
  // `best` indexes the takes that arrived; `pick` and `picked` name a take by its file (take<k>), which
  // differ once a take has failed.
  let best = 0, pickedBy = null, pickReason = null;
  if (takes.length > 1 && Number.isInteger(cfg.pick)) {
    best = Math.max(0, takes.findIndex((t) => t.k === cfg.pick));
    if (takes[best].k !== cfg.pick) onWarn(`${item.id}: pick ${cfg.pick} has no take on disk, keeping take ${takes[best].k}`);
  } else if (takes.length > 1) {
    try {
      const { data, model } = await ask({
        prompt: pickTakePrompt({ count: takes.length, aspect, prompt: cfg.prompt, brief: cfg.brief }),
        images: await Promise.all(takes.map((t) => jpegPart(join(dir, t.file.slice("assets/".length)), 768))), json: true, maxTokens: 2000, config: { llm },
      });
      if (Number.isInteger(data.best) && data.best >= 0 && data.best < takes.length) [best, pickedBy, pickReason] = [data.best, model, data.reason ?? null];
    } catch (e) {
      onWarn(`${item.id}: vision pick failed, keeping take ${takes[0].k} (${e.message})`);
    }
  }
  const chosen = takes[best];
  let file = chosen.file;
  if (takes.length > 1) {
    file = `assets/${item.id}.${imageExt(chosen.buf)}`;
    writeFileSync(join(dir, file.slice("assets/".length)), chosen.buf);
  }
  return {
    ...item, file, kind: "image", via: "generate", license: "generated", author: chosen.model, title: item.title ?? cfg.prompt.slice(0, 80),
    ...(takes.length > 1 ? { takes: takes.map((t) => t.file), picked: chosen.k, ...(pickedBy ? { pickedBy, pickReason } : {}) } : {}),
    fetchedAt: new Date().toISOString(),
  };
}
