// Text- or image-to-video through the relay's /videos task API.
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request, requireApiKey } from "../core/http.mjs";
import { clipFrames, cutClip, framesDir } from "../assets/media.mjs";
import { VIDEO_DEFAULTS, firstModel, genConfig, jpegPart, sleep } from "./common.mjs";
import { inspectClip } from "./inspect.mjs";

// Text- or image-to-video through the relay's /videos task API: submit, poll, download, then the
// same cut + frame sequence as any fetched clip. `from: <asset id>` animates that (already
// fetched) image as the first frame.
export async function generateVideo(item, { publicDir, defaults = {}, aspect = "16:9", lookup = () => null, llm = {}, onWarn = () => {} }) {
  const cfg = genConfig(item, VIDEO_DEFAULTS, defaults);
  const key = requireApiKey(cfg.keyEnv, cfg.baseUrl);
  const base = cfg.baseUrl.replace(/\/$/, "");
  let image;
  if (cfg.from) {
    const src = lookup(cfg.from);
    if (!src?.file || !existsSync(join(publicDir, src.file))) throw new Error(`asset "${item.id}": generate.from "${cfg.from}" is not fetched yet`);
    image = { url: (await jpegPart(join(publicDir, src.file), 1280)).image_url.url };
  }
  const t = await firstModel(cfg, `video "${item.id}"`, async (model) => {
    const json = { model, prompt: cfg.prompt, duration: Math.round(cfg.duration), aspect_ratio: aspect, resolution: cfg.resolution, ...(image ? { image } : {}) };
    const sub = JSON.parse((await request(`${base}/videos`, { method: "POST", key, json, timeoutSec: 120, retries: 1 })).body.toString());
    if (!sub.id) throw new Error(`no task id: ${JSON.stringify(sub).slice(0, 200)}`);
    const deadline = Date.now() + cfg.timeoutSec * 1000;
    for (;;) {
      const st = JSON.parse((await request(`${base}/videos/${sub.id}`, { key, timeoutSec: 60, retries: 2 })).body.toString());
      if (/^(completed|succeeded|done)$/.test(st.status ?? st.state)) break;
      if (/^(failed|error|cancelled|canceled)$/.test(st.status ?? st.state)) throw new Error(st.error?.message ?? `task ${st.status}`);
      if (Date.now() > deadline) throw new Error(`task ${sub.id} still ${st.status} after ${cfg.timeoutSec}s`);
      await sleep(cfg.pollSec);
    }
    return { buf: (await request(`${base}/videos/${sub.id}/content`, { key, timeoutSec: 600, retries: 2 })).body, task: sub.id };
  });
  const dir = join(publicDir, "assets");
  const file = `assets/${item.id}.mp4`;
  const raw = join(dir, `${item.id}.src.mp4`);
  writeFileSync(raw, t.buf);
  let dims, inspect = null;
  try {
    if (!item.clip && cfg.inspect !== false) {
      try {
        inspect = await inspectClip(raw, { prompt: cfg.prompt, brief: cfg.brief, keep: cfg.keep, llm });
        if (inspect.score !== null && inspect.score <= 4) onWarn(`${item.id}: generated take scored ${inspect.score}/10 (${inspect.issues.map((x) => `${x.t}s ${x.issue}`).join("; ") || "no detail"}); consider regenerating (assets fetch --only ${item.id} --force)`);
        if (!inspect.clip) onWarn(`${item.id}: inspection found no clean stretch; keeping the whole take`);
      } catch (e) {
        onWarn(`${item.id}: clip inspection failed, keeping the whole take (${e.message.split("\n")[0]})`);
      }
    }
    dims = await cutClip(raw, join(publicDir, file), item.clip ?? inspect?.clip ?? (cfg.keep ? [0, cfg.keep] : undefined));
  } finally { rmSync(raw, { force: true }); }
  await clipFrames(join(publicDir, file), join(publicDir, framesDir(file)));
  return {
    ...item, file, kind: "video", via: "generate", license: "generated", author: t.model, title: item.title ?? cfg.prompt.slice(0, 80), ...dims,
    ...(inspect ? { inspect: { model: inspect.model, score: inspect.score, issues: inspect.issues, ...(inspect.clip ? { kept: inspect.clip } : {}) } } : {}),
    fetchedAt: new Date().toISOString(),
  };
}
