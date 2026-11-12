// Chat models behind the same OpenAI-compatible relay as TTS and image generation: a second pair
// of eyes for the director (frame review, picking between generated takes). Relay channels come and
// go, so a call walks `models` in order and takes the first one that answers with content.
import { readFileSync } from "node:fs";
import { request, requireApiKey } from "../core/http.mjs";

export const LLM_DEFAULTS = { baseUrl: "https://api.mangoqwq.com/v1", keyEnv: "MANGO_API_KEY", models: ["glm-5.3-flash", "gemini-3.8-flash", "gpt-6-luna", "deepseek-v4-flash"] };

export const llmConfig = (config = {}) => ({ ...LLM_DEFAULTS, ...(config.llm ?? {}) });

const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

// An image content part from a file or a Buffer (+ mime).
export function imagePart(src, mime) {
  const buf = Buffer.isBuffer(src) ? src : readFileSync(src);
  const type = mime ?? MIME[String(src).split(".").pop().toLowerCase()] ?? "image/jpeg";
  return { type: "image_url", image_url: { url: `data:${type};base64,${buf.toString("base64")}` } };
}

// The JSON object or array in a reply: a ```json block when there is one, else the longest value that
// parses, so prose before it ("cells [3] and [4]: {…}") is not taken for the answer. With `partial`,
// a reply cut off mid-way (relays cap output, reasoning tokens included) is closed after its last
// complete element instead of rejected; the result then carries a `truncated` marker.
export function parseJsonReply(text, { partial = false } = {}) {
  const raw = String(text ?? "");
  const fenced = /```json\s*([\s\S]*?)(?:```|$)/i.exec(raw)?.[1];
  if (fenced) try { return findJson(fenced, partial); } catch { /* fall through to the whole reply */ }
  return findJson(raw.replace(/```(?:json)?/gi, ""), partial);
}

// Where the value opening at `start` closes ({ end }), or how to close it after its last complete element ({ cut }).
function scanJson(s, start) {
  const stack = [];
  let inStr = false, cut = null;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") {
      stack.pop();
      if (!stack.length) return { end: i + 1 };
      cut = { at: i + 1, close: stack.slice().reverse().join("") };
    }
  }
  return { cut };
}

function findJson(s, partial) {
  let best = null, open = -1, bad = null;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "{" && s[i] !== "[") continue;
    const { end, cut } = scanJson(s, i);
    try {
      if (end) {
        const value = JSON.parse(s.slice(i, end));
        if (!best || end - i > best.len) best = { value, len: end - i };
        i = end - 1; // values inside this one are shorter
      } else {
        if (open < 0) open = i;
        if (partial && cut && (!best || cut.at - i > best.len)) {
          best = { value: Object.assign(JSON.parse(s.slice(i, cut.at) + cut.close), { truncated: true }), len: cut.at - i };
          break; // anything opening later is inside this value, so shorter
        }
      }
    } catch (e) { bad ??= e; }
  }
  if (best) return best.value;
  if (open >= 0) throw new Error(`unterminated JSON in reply (${s.length - open} chars): ${s.slice(open, open + 120).replace(/\s+/g, " ")}`);
  if (bad) throw bad;
  throw new Error(`no JSON in reply: ${s.slice(0, 120)}`);
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
