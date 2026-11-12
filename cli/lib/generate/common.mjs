// Shared by image and video generation: relay defaults, per-item config, model fallback and the
// JPEG data-URL parts vision calls and video submits send.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpeg } from "../core/ffmpeg.mjs";
import { imagePart } from "../llm/client.mjs";

export const IMAGE_DEFAULTS = { baseUrl: "https://api.mangoqwq.com/v1", models: ["gpt-image-2.5", "grok-imagine-image-quality"], keyEnv: "MANGO_API_KEY" };
export const VIDEO_DEFAULTS = { baseUrl: "https://api.mangoqwq.com/v1", models: ["grok-imagine-video", "grok-imagine-video-1.5"], duration: 6, resolution: "720p", keyEnv: "MANGO_API_KEY", pollSec: 5, timeoutSec: 900 };
// 4:5 has no size of its own on the image models: the portrait size, cropped to the frame.
export const IMAGE_SIZE = { "16:9": "1536x1024", "9:16": "1024x1536", "1:1": "1024x1024", "4:5": "1024x1536" };
// The same for clips: the video models take the common ratios only.
export const VIDEO_ASPECT = { "4:5": "9:16" };

// item.generate (string prompt or object) over project defaults; `model` pins one model, `models` is
// the fallback order. Relay channels come and go, so each model is tried until one delivers.
export function genConfig(item, base, defaults) {
  const own = typeof item.generate === "object" ? item.generate : { prompt: item.generate };
  const cfg = { ...base, ...defaults, ...own };
  cfg.models = [].concat(own.model ?? own.models ?? defaults.model ?? defaults.models ?? base.models);
  if (!cfg.prompt) throw new Error(`asset "${item.id}": generate.prompt is required`);
  return cfg;
}

export const imageExt = (buf) => (buf[0] === 0x89 ? "png" : buf[0] === 0xff ? "jpg" : "webp");

// An image as a JPEG data-URL part at most `width` px wide: full-size PNG takes run to megabytes,
// which vision calls and video submits time out on. Undecodable input goes as is.
export async function jpegPart(file, width) {
  const tmp = mkdtempSync(join(tmpdir(), "ov-jpeg-"));
  try {
    const out = join(tmp, "x.jpg");
    await ffmpeg(["-y", "-v", "error", "-i", file, "-frames:v", "1", "-vf", `scale='min(${width},iw)':-2`, "-q:v", "3", out]);
    return imagePart(readFileSync(out), "image/jpeg");
  } catch {
    return imagePart(file);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function firstModel(cfg, what, fn) {
  const failures = [];
  for (const model of cfg.models) {
    try { return { model, ...(await fn(model)) }; } catch (e) { failures.push(`${model}: ${e.message.split("\n")[0].slice(0, 200)}`); }
  }
  throw new Error(`${what} failed on every model (${failures.join("; ")})`);
}

export const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
