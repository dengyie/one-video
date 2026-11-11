// Chat models behind the same OpenAI-compatible relay as TTS and image generation: a second pair
// of eyes for the director (frame review, picking between generated takes). Relay channels come and
// go, so a call walks `models` in order and takes the first one that answers with content.
import { readFileSync } from "node:fs";
import { request, requireApiKey } from "../core/http.mjs";

export const LLM_DEFAULTS = { baseUrl: "https://api.mangoqwq.com/v1", keyEnv: "MANGO_API_KEY", models: ["gpt-6.1-terra", "glm-5.3-flash", "gemini-3.7-flash"] };

export const llmConfig = (config = {}) => ({ ...LLM_DEFAULTS, ...(config.llm ?? {}) });

const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

// An image content part from a file or a Buffer (+ mime).
export function imagePart(src, mime) {
  const buf = Buffer.isBuffer(src) ? src : readFileSync(src);
  const type = mime ?? MIME[String(src).split(".").pop().toLowerCase()] ?? "image/jpeg";
  return { type: "image_url", image_url: { url: `data:${type};base64,${buf.toString("base64")}` } };
}

// The first JSON object or array in a reply, tolerating ```json fences and surrounding prose. With
// `partial`, a reply cut off mid-way (relays cap output, reasoning tokens included) is closed after
// its last complete element instead of rejected; the result then carries a `truncated` marker.
export function parseJsonReply(text, { partial = false } = {}) {
  const s = String(text ?? "").replace(/```(?:json)?/gi, "");
  const start = s.search(/[[{]/);
  if (start < 0) throw new Error(`no JSON in reply: ${s.slice(0, 120)}`);
  const stack = [];
  let inStr = false, cut = null;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") {
      stack.pop();
      if (!stack.length) return JSON.parse(s.slice(start, i + 1));
      cut = { at: i + 1, close: stack.slice().reverse().join("") };
    }
  }
  if (partial && cut) return Object.assign(JSON.parse(s.slice(start, cut.at) + cut.close), { truncated: true });
  throw new Error(`unterminated JSON in reply (${s.length - start} chars): ${s.slice(start, start + 120).replace(/\s+/g, " ")}`);
}

// A broken relay channel can answer every request with the same canned line ("task ready", "ok")
// instead of the model's output; that is a dead channel, not a garbled answer, so no retry.
export const isPlaceholder = (text) => /^\W*(task (ready|received|submitted)|ok|done|processing)\W*$/i.test(String(text ?? "").trim());

// One user turn (text + optional images) → { text, model } or, with json, { data, model }.
// A model that errors or returns nothing is skipped for the next; unparseable JSON gets one more try.
export async function ask({ prompt, images = [], system, json = false, maxTokens = 2000, config = {} }) {
  const cfg = llmConfig(config);
  const key = requireApiKey(cfg.keyEnv, cfg.baseUrl);
  const content = images.length ? [{ type: "text", text: prompt }, ...images.map((im) => (im.type ? im : imagePart(im)))] : prompt;
  const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content }];
  const failures = [];
  for (const model of [].concat(cfg.models)) for (let take = 1; take <= (json ? 2 : 1); take++) {
    try {
      const res = await request(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", key, json: { model, messages, max_tokens: maxTokens, temperature: 0.2 }, timeoutSec: 180, retries: 1 });
      const j = JSON.parse(res.body.toString());
      const text = j.choices?.[0]?.message?.content;
      if (!text?.trim()) throw new Error(`empty reply${j.error ? `: ${JSON.stringify(j.error).slice(0, 160)}` : ""}`);
      if (/^⚠️? ?Upstream .* empty response/i.test(text)) throw new Error("upstream returned an empty response");
      if (isPlaceholder(text)) throw new Error(`placeholder reply from the relay: ${text.trim()}`);
      if (!json) return { text, model };
      try {
        return { data: parseJsonReply(text, { partial: true }), model };
      } catch (e) {
        e.retry = true; // a garbled answer is often a one-off: ask the same model once more
        throw e;
      }
    } catch (e) {
      failures.push(`${model}: ${e.message.split("\n")[0].slice(0, 200)}`);
      if (!e.retry) break;
    }
  }
  throw new Error(`no model answered (${failures.join("; ")})`);
}
