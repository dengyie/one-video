import { request } from "../core/http.mjs";
import { parseWav } from "../audio/wav.mjs";

// The chat request for one synthesis: the style (or speaker description) is the user
// turn, the text the assistant turn. Voice design itself takes no voice.
export function chatRequest(speak, t) {
  const messages = [{ role: "assistant", content: speak }];
  if (t.style ?? t.instructions) messages.unshift({ role: "user", content: t.style ?? t.instructions });
  const audio = t.design === true ? { format: "wav" } : { format: "wav", voice: t.refData ?? t.voice };
  return { model: t.model, messages, audio, stream: false };
}

const requestOptions = (json, key) => ({ method: "POST", json, key, timeoutSec: 240, retries: 3 });

const PROVIDERS = {
  async chat(speak, t, key, base, send) {
    const res = await send(`${base}/chat/completions`, requestOptions(chatRequest(speak, t), key));
    let data;
    try { data = JSON.parse(res.body.toString()).choices?.[0]?.message?.audio?.data; } catch { /* reported below */ }
    if (!data) throw new Error(`TTS chat response has no audio: ${res.body.subarray(0, 200).toString()}`);
    return Buffer.from(data, "base64");
  },
  async speech(speak, t, key, base, send) {
    const json = { model: t.model, input: speak, voice: t.voice, response_format: "wav" };
    if (t.speed) json.speed = t.speed;
    if (t.instructions ?? t.style) json.instructions = t.instructions ?? t.style;
    return (await send(`${base}/audio/speech`, requestOptions(json, key))).body;
  },
};

export async function synthesize(speak, t, key, send = request) {
  const provider = Object.hasOwn(PROVIDERS, t.protocol) ? PROVIDERS[t.protocol] : PROVIDERS.speech;
  const wav = await provider(speak, t, key, t.baseUrl.replace(/\/$/, ""), send);
  if (wav.subarray(0, 4).toString() !== "RIFF") throw new Error(`TTS returned non-WAV data: ${wav.subarray(0, 200).toString()}`);
  parseWav(wav, { strict: true }); // fail fast on a truncated file
  return wav;
}
