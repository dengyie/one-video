// Resolve one manifest item to a local file: a UI capture, an AI generation (../generate), a URL
// or the best-ranked stock search hit. Videos are cut to a short silent H.264 clip.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { download } from "../core/http.mjs";
import { generateImage, generateVideo } from "../generate/index.mjs";
import { DEFAULT_PROVIDER_ORDER, DEFAULT_VIDEO_PROVIDERS, fullUrl, scoreCandidate, search } from "./sources.mjs";
import { clipFrames, cutClip, framesDir, pickClipWindow } from "./media.mjs";

const extOf = (url, fallback) => (String(url).match(/\.(jpe?g|png|webp|mp4|webm|mov|ogv|avi)(?:$|[?#])/i)?.[1].toLowerCase().replace("jpeg", "jpg") ?? fallback);

// Resolve one manifest item to a local file; returns the updated item.
// `gen` carries generation settings: { aspect: "16:9", image, video, llm, ask, lookup, onWarn } (`ask`,
// the LLM client's, also picks where a long film is cut). A failed
// generation falls back to the stock search when the item also has a query.
export async function fetchAsset(item, { publicDir, aspect = 16 / 9, gen = {} }) {
  const dir = join(publicDir, "assets");
  mkdirSync(dir, { recursive: true });

  // A still standing in for a failed clip goes back to being the clip it was meant to be.
  if (item.fallback) { const { fallback: _f, file: _file, ...rest } = item; item = { ...rest, kind: "video" }; }

  // A UI capture re-shoots itself with the settings it was taken with.
  if (item.capture?.url) return (await import("../../commands/media.mjs")).captureItem(item, publicDir);

  if (item.generate) {
    const opts = { dir, publicDir, aspect: gen.aspect, llm: gen.llm, lookup: gen.lookup, onWarn: gen.onWarn ?? (() => {}) };
    try {
      return item.kind === "video" ? await generateVideo(item, { ...opts, defaults: gen.video ?? {} }) : await generateImage(item, { ...opts, defaults: gen.image ?? {} });
    } catch (e) {
      const still = item.kind === "video" && stillFallback(item, { publicDir, lookup: gen.lookup, reason: e.message });
      if (still) {
        opts.onWarn(`${item.id}: ${e.message.split("\n")[0].slice(0, 200)}; using still "${still.fallback.from}" (camera moves it; the next assets fetch tries the clip again)`);
        return still;
      }
      if (!item.query && !item.url) throw e;
      opts.onWarn(`${item.id}: ${e.message}; falling back to ${item.url ? "url" : `search "${item.query}"`}`);
    }
  }

  let chosen = null;
  if (item.url) chosen = { url: item.url, license: item.license, author: item.author, title: item.title, source: item.source ?? item.url, provider: "url", kind: item.kind ?? "image" };
  else {
    if (!item.query) throw new Error(`asset "${item.id}" needs one of: url, query, generate`);
    const providers = item.provider ? [].concat(item.provider) : item.kind === "video" ? DEFAULT_VIDEO_PROVIDERS() : DEFAULT_PROVIDER_ORDER;
    const { results, errors } = await search(item.query, { providers, kind: item.kind ?? "image" });
    const ranked = results.filter((c) => c.kind === (item.kind ?? "image")).sort((a, b) => scoreCandidate(a, aspect) - scoreCandidate(b, aspect));
    chosen = ranked[item.pick ?? 0];
    if (!chosen) throw new Error(`no ${item.kind ?? "image"} results for "${item.query}"${errors.length ? ` (${errors.join("; ")})` : ""}`);
  }
  if (!chosen.url) chosen.url = await fullUrl(chosen);
  if (!chosen.url) throw new Error(`asset "${item.id}": candidate has no downloadable URL`);
  const buf = await download(chosen.url, chosen.kind === "video" ? { timeoutSec: 900 } : undefined);
  let file;
  if (chosen.kind === "video") {
    file = `assets/${item.id}.mp4`;
    const raw = join(dir, `${item.id}.src.${extOf(chosen.url, "mp4")}`);
    writeFileSync(raw, buf);
    try {
      // No window given: one is picked once and kept in the manifest, so a refetch cuts the same.
      if (!item.clip) {
        const w = await pickClipWindow(raw, { brief: [item.query, chosen.title].filter(Boolean).join(" · "), llm: gen.llm, askFn: gen.ask, onWarn: (m) => (gen.onWarn ?? (() => {}))(`${item.id}: ${m}`) });
        if (w) item = { ...item, clip: w.clip, ...(w.pick ? { clipPick: w.pick } : {}) };
      }
      Object.assign(chosen, await cutClip(raw, join(publicDir, file), item.clip));
    } finally { rmSync(raw, { force: true }); }
    await clipFrames(join(publicDir, file), join(publicDir, framesDir(file)));
  } else {
    file = `assets/${item.id}.${extOf(chosen.url, "jpg")}`;
    writeFileSync(join(publicDir, file), buf);
  }
  return {
    ...item,
    file,
    kind: chosen.kind,
    via: chosen.provider,
    title: item.title ?? chosen.title,
    author: item.author ?? chosen.author,
    license: item.license ?? chosen.license,
    source: item.source ?? chosen.source,
    width: chosen.width ?? item.width,
    height: chosen.height ?? item.height,
    ...(chosen.kind === "video" ? { duration: chosen.duration ?? null } : {}),
    fetchedAt: new Date().toISOString(),
  };
}

// A clip animated from a still (generate.from) whose generation failed — the video relay is often
// rate-limited — stands in as that still: footage scenes move an image with the same camera, so the
// cut still plays. Marked `fallback`, it is generated again on the next assets fetch.
// generate.still: false turns this off.
export function stillFallback(item, { publicDir, lookup = () => null, reason = "" }) {
  const from = typeof item.generate === "object" && item.generate.still !== false ? item.generate.from : null;
  const src = from ? lookup(from) : null;
  if (!src?.file || src.kind === "video" || src.fallback || !existsSync(join(publicDir, src.file))) return null;
  const { duration: _d, inspect: _i, ...rest } = item;
  return {
    ...rest, file: src.file, kind: "image", via: "still", license: src.license, author: src.author, source: src.source, title: item.title ?? src.title ?? String(item.generate.prompt ?? from).slice(0, 80),
    width: src.width, height: src.height, fallback: { from, reason: reason.split("\n")[0].slice(0, 200) }, fetchedAt: new Date().toISOString(),
  };
}
